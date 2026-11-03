"""Budget boundaries and durable candidate-import transitions, without Cloudflare calls."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('multiday_runtime_test', Path(__file__).with_name('multiday-staging.py'))
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)
budget, imp = run.budget, run.imp
NOW = dt.datetime(2026, 11, 2, 12, tzinfo=dt.timezone.utc)
ACCOUNT = 'a' * 32
CANDIDATE = '10000000-0000-4000-8000-000000000000'
NAME = 'workshop-staging-migrate-0123456789ab'


def usage(written=0, read=0):
    return {'day': budget.day_key(), 'rows_written': written, 'rows_read': read}


class BudgetTest(unittest.TestCase):
    def test_shared_account_usage_blocks_before_migration_writes(self):
        result = budget.decide({'day': '2026-11-02', 'rows_written': 69_900, 'rows_read': 0}, {}, 128, NOW)
        self.assertFalse(result['allowed'])
        self.assertEqual(result['reason'], 'account_write_reserve')
        self.assertEqual(result['next_attempt_at'], '2026-11-03T00:05:00+00:00')

    def test_lower_later_analytics_does_not_reopen_known_exhausted_budget(self):
        ledger = {}
        budget.observe(ledger, {'day': '2026-11-02', 'rows_written': 69_900, 'rows_read': 0})
        budget.observe(ledger, {'day': '2026-11-02', 'rows_written': 0, 'rows_read': 0})
        resumed = json.loads(json.dumps(ledger))
        self.assertFalse(budget.decide({'day': '2026-11-02', 'rows_written': 0, 'rows_read': 0}, resumed, 128, NOW)['allowed'])
        budget.observe(resumed, {'day': '2026-11-02', 'rows_written': 0, 'rows_read': 4_000_000})
        self.assertEqual(budget.decide({'day': '2026-11-02', 'rows_written': 0, 'rows_read': 0}, resumed, 0, NOW)['reason'], 'account_read_reserve')

    def test_uncertain_write_reservation_survives_delayed_analytics(self):
        ledger = {}
        budget.reserve(ledger, 40_000, NOW)
        result = budget.decide({'day': '2026-11-02', 'rows_written': 0, 'rows_read': 0}, ledger, 20_000, NOW)
        self.assertFalse(result['allowed'])
        budget.settle(ledger, '2026-11-02', 40_000, 8_000, NOW)
        self.assertTrue(budget.decide({'day': '2026-11-02', 'rows_written': 8_000, 'rows_read': 0}, ledger, 20_000, NOW)['allowed'])

    def test_utc_reset_is_not_a_refund_for_unknown_cross_day_execution(self):
        ledger = {}
        day = budget.reserve(ledger, 4_000, NOW)
        tomorrow = NOW + dt.timedelta(days=1)
        budget.settle(ledger, day, 4_000, 1_000, tomorrow)
        self.assertEqual(ledger, {'2026-11-02': {'charged': 4_000}, '2026-11-03': {'charged': 1_000}})
        result = budget.decide({'day': '2026-11-03', 'rows_written': 0, 'rows_read': 0}, ledger, 2_000, tomorrow)
        self.assertTrue(result['allowed'])

    def test_last_five_minutes_and_unexecutable_batch_are_rejected(self):
        late = NOW.replace(hour=23, minute=56)
        result = budget.decide({'day': '2026-11-02', 'rows_written': 0, 'rows_read': 0}, {}, 128, late)
        self.assertEqual(result['reason'], 'utc_reset_window')
        with self.assertRaises(ValueError):
            budget.decide({'day': '2026-11-02', 'rows_written': 0, 'rows_read': 0}, {}, 50_001, NOW)


class CarryforwardTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.plan_path = self.root / 'plan.json'
        self.plan_path.write_text('{}')

    def create(self, name, identity, prior=(), account=ACCOUNT):
        plan = {'plan_id': identity * 64, 'candidate_name': NAME, 'batches': []}
        return run.open_journal(self.root / name, self.plan_path, plan, account, FakeCloud.token, prior)

    def test_same_day_candidates_carry_unknown_reservations_and_exhaust_budget(self):
        first = self.create('first', '1')
        day = budget.reserve(first.state['ledger'], 49_900)
        first.record('unknown', ledger=first.state['ledger'], pending={'reserved': 49_900, 'day': day})
        first.close()
        second = self.create('second', '2', [self.root / 'first'])
        try:
            with patch.object(budget, 'analytics', return_value=usage()):
                self.assertFalse(run.allowance(second, ACCOUNT, FakeCloud.token, 128))
            self.assertEqual(second.state['ledger'][day]['charged'], 49_900)
            self.assertEqual(second.state['budget']['reason'], 'migration_daily_ceiling')
            with self.assertRaisesRegex(ValueError, 'only be supplied'):
                self.create('second', '2', [self.root / 'first'])
        finally:
            second.close()
        with self.assertRaisesRegex(ValueError, 'double-carry'):
            self.create('third', '3', [self.root / 'first', self.root / 'second'])

    def test_mismatched_or_unverifiable_prior_state_is_rejected(self):
        other = self.create('other', '1', account='b' * 32)
        other.close()
        with self.assertRaisesRegex(ValueError, 'cannot be verified'):
            self.create('new', '2', [self.root / 'other'])
        damaged = self.create('damaged', '3')
        damaged.record('invalid', ledger={'2026-11-03': {'charged': -1}})
        damaged.close()
        with self.assertRaisesRegex(ValueError, 'ledger cannot be verified'):
            self.create('new', '2', [self.root / 'damaged'])

    def test_receipt_over_reservation_stops_before_another_batch(self):
        journal = self.create('state', '1')
        self.addCleanup(journal.close)
        ledger = {}
        day = budget.reserve(ledger, 128)
        pending = {'day': day, 'reserved': 128, 'index': 0}
        journal.record('batch-requested', ledger=ledger, pending=pending)
        with self.assertRaisesRegex(imp.ImportFailure, 'exceeded reservation'):
            run.finish_batch(journal, pending, {'outcome': 'complete', 'ok': True,
                                                'statistics': {'rows_written': 129}})
        self.assertEqual(journal.state['ledger'][day]['charged'], 129)
        self.assertEqual(journal.state['phase'], 'failed')
        with self.assertRaisesRegex(imp.ImportFailure, 'execution is failed'):
            run.advance(journal, FakeCloud(), self.plan_path, {'batches': []}, 1)


class FakeCloud:
    account = ACCOUNT
    token = 'synthetic-test-credential'

    def identity(self, database, name):
        imp.validate_identity(database, {'uuid': CANDIDATE, 'name': NAME}, name)

    def discover(self, _name):
        return {'uuid': CANDIDATE, 'name': NAME, 'created_at': NOW.isoformat()}


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.database = sqlite3.connect(':memory:')
        self.addCleanup(self.database.close)
        self.database.executescript('CREATE TABLE ledger(id TEXT PRIMARY KEY); CREATE TABLE counters(n INTEGER); INSERT INTO counters VALUES(0);')
        self.plan = {'plan_id': '0123456789ab' + '0' * 52, 'candidate_name': NAME, 'batches': []}
        for number in range(2):
            sql = self.root / f'{number}.sql'
            sql.write_text(f"INSERT INTO ledger VALUES ('{number}'); UPDATE counters SET n=n+1;")
            self.plan['batches'].append({'id': str(number), 'file': sql.name, 'sha256': run.digest(sql), 'estimated_rows_written': 2})
        self.plan_path = self.root / 'plan.json'
        self.plan_path.write_text(json.dumps(self.plan))
        self.journal = run.open_journal(self.root / 'state', self.plan_path, self.plan, ACCOUNT, FakeCloud.token)
        self.addCleanup(lambda: self.journal.close())
        self.journal.record('test-owned-candidate', candidate_database_id=CANDIDATE)
        self.executions = 0
        environment = patch.dict('os.environ', {'STAGING_IMPORT_TOKEN': FakeCloud.token, 'CLOUDFLARE_ACCOUNT_ID': ACCOUNT})
        environment.start()
        self.addCleanup(environment.stop)

    def execute(self, database, sql, artifacts, candidate_name=None, ambiguous=False):
        self.executions += 1
        child = imp.Journal(artifacts, FakeCloud.token, create=True)
        try:
            child.record('prepared', version=1, account_id=ACCOUNT, database_id=database, candidate_name=candidate_name,
                         file={'sha256': run.digest(sql)}, phase='ingest_unknown')
            self.database.executescript(Path(sql).read_text())
            if ambiguous:
                raise imp.ImportFailure('synthetic lost ingest response')
            child.record('complete', outcome='complete', phase='complete', statistics={'rows_written': 2})
            result = child.summary()
        finally:
            child.close()
        if self.executions == 1:
            raise imp.ImportFailure('synthetic interruption after terminal receipt')
        return result

    def advance(self):
        return run.advance(self.journal, FakeCloud(), self.plan_path, self.plan, 2)

    def test_completed_receipt_after_interruption_advances_without_replaying_sql(self):
        with patch.object(budget, 'analytics', return_value=usage()), patch.object(imp, 'execute', side_effect=self.execute):
            with self.assertRaises(imp.ImportFailure):
                self.advance()
            self.journal.close()
            self.journal = run.open_journal(self.root / 'state', self.plan_path, self.plan, ACCOUNT, FakeCloud.token)
            self.assertTrue(self.advance())
        self.assertEqual(self.executions, 2)
        self.assertEqual(self.database.execute('SELECT n FROM counters').fetchone()[0], 2)
        self.assertEqual(list(self.database.execute('SELECT id FROM ledger ORDER BY id')), [('0',), ('1',)])
        self.assertEqual(self.journal.state['next_batch'], 2)

    def test_interruption_before_importer_prepared_receipt_can_resume_safely(self):
        ledger = {}
        day = budget.reserve(ledger, 128)
        pending = {'index': 0, 'id': '0', 'sha256': self.plan['batches'][0]['sha256'],
                   'day': day, 'reserved': 128, 'receipts': str(self.root / 'state' / 'unstarted')}
        receipts = Path(pending['receipts'])
        receipts.mkdir(mode=0o700)
        partial = receipts / 'input.sql'
        partial.write_text('INSER')
        partial.chmod(0o600)
        self.journal.record('batch-requested', phase='batch_unknown', ledger=ledger, pending=pending)
        with patch.object(budget, 'analytics', return_value=usage()), patch.object(imp, 'execute', side_effect=self.execute):
            with self.assertRaises(imp.ImportFailure):
                self.advance()
            self.assertTrue(self.advance())
        self.assertEqual(self.executions, 2)
        self.assertEqual(self.database.execute('SELECT n FROM counters').fetchone()[0], 2)
        self.assertEqual(self.journal.state['ledger'][day]['charged'], 4)
        self.assertEqual(partial.read_text(), 'INSER')

    def test_interrupted_read_only_target_lookup_restarts_before_initialization(self):
        receipts = self.root / 'state' / 'target-interrupted'
        child = imp.Journal(receipts, FakeCloud.token, create=True)
        try:
            child.record('prepared', version=1, account_id=ACCOUNT, database_id=CANDIDATE,
                         candidate_name=NAME, file={'sha256': self.plan['batches'][0]['sha256']},
                         phase='target_unknown')
        finally:
            child.close()
        ledger = {}
        day = budget.reserve(ledger, 128)
        pending = {'index': 0, 'id': '0', 'sha256': self.plan['batches'][0]['sha256'],
                   'day': day, 'reserved': 128, 'receipts': str(receipts)}
        self.journal.record('batch-requested', phase='batch_unknown', ledger=ledger, pending=pending)
        with patch.object(budget, 'analytics', return_value=usage()), patch.object(imp, 'execute', side_effect=self.execute):
            with self.assertRaises(imp.ImportFailure):
                self.advance()
            self.assertTrue(self.advance())
        self.assertEqual(self.executions, 2)
        self.assertEqual(self.database.execute('SELECT n FROM counters').fetchone()[0], 2)

    def test_initialization_without_bookmark_remains_ambiguous_and_is_not_retried(self):
        receipts = self.root / 'state' / 'init-interrupted'
        child = imp.Journal(receipts, FakeCloud.token, create=True)
        try:
            child.record('prepared', version=1, account_id=ACCOUNT, database_id=CANDIDATE,
                         candidate_name=NAME, file={'sha256': self.plan['batches'][0]['sha256']},
                         phase='init_requested')
        finally:
            child.close()
        ledger = {}
        day = budget.reserve(ledger, 128)
        pending = {'index': 0, 'id': '0', 'sha256': self.plan['batches'][0]['sha256'],
                   'day': day, 'reserved': 128, 'receipts': str(receipts)}
        self.journal.record('batch-requested', phase='batch_unknown', ledger=ledger, pending=pending)
        with patch.object(budget, 'analytics', return_value=usage()), patch.object(imp, 'execute', side_effect=self.execute):
            with self.assertRaisesRegex(imp.ImportFailure, 'no saved actual at_bookmark'):
                self.advance()
        self.assertEqual(self.executions, 0)
        self.assertEqual(self.journal.state['ledger'][day]['charged'], 128)

    def test_missing_numbered_receipt_with_existing_state_is_not_retried(self):
        receipts = self.root / 'state' / 'damaged'
        receipts.mkdir(mode=0o700)
        state = receipts / 'state.json'
        state.write_text('{}')
        state.chmod(0o600)
        ledger = {}
        day = budget.reserve(ledger, 128)
        pending = {'index': 0, 'id': '0', 'sha256': self.plan['batches'][0]['sha256'],
                   'day': day, 'reserved': 128, 'receipts': str(receipts)}
        self.journal.record('batch-requested', phase='batch_unknown', ledger=ledger, pending=pending)
        with patch.object(budget, 'analytics', return_value=usage()), patch.object(imp, 'execute', side_effect=self.execute):
            with self.assertRaisesRegex(imp.ImportFailure, 'unexplained local evidence'):
                self.advance()
        self.assertEqual(self.executions, 0)
        self.assertEqual(self.journal.state['ledger'][day]['charged'], 128)

    def test_unknown_ingest_keeps_reservation_and_never_replays(self):
        def ambiguous(*args, **kwargs):
            return self.execute(*args, **kwargs, ambiguous=True)
        with patch.object(budget, 'analytics', return_value=usage()), patch.object(imp, 'execute', side_effect=ambiguous):
            with self.assertRaises(imp.ImportFailure):
                self.advance()
            charged = self.journal.state['ledger'][budget.day_key()]['charged']
            with self.assertRaisesRegex(imp.ImportFailure, 'no saved actual at_bookmark'):
                self.advance()
        self.assertEqual(self.executions, 1)
        self.assertEqual(self.database.execute('SELECT n FROM counters').fetchone()[0], 1)
        self.assertEqual(self.journal.state['ledger'][budget.day_key()]['charged'], charged)

    def test_account_exhaustion_performs_no_sql_and_retains_next_batch(self):
        with patch.object(budget, 'analytics', return_value=usage(written=100_000)), patch.object(imp, 'execute', side_effect=self.execute):
            self.assertFalse(self.advance())
        self.assertEqual(self.executions, 0)
        self.assertEqual(self.database.execute('SELECT n FROM counters').fetchone()[0], 0)
        self.assertEqual(self.journal.state['next_batch'], 0)
        self.assertEqual(self.journal.state['phase'], 'waiting_budget')

    def test_analytics_failure_performs_no_sql(self):
        with patch.object(budget, 'analytics', side_effect=RuntimeError('analytics unavailable')), patch.object(imp, 'execute', side_effect=self.execute):
            with self.assertRaises(RuntimeError):
                self.advance()
        self.assertEqual(self.executions, 0)
        self.assertIsNone(self.journal.state['pending'])

    def test_changed_plan_and_existing_unowned_candidate_are_not_adopted(self):
        self.journal.close()
        self.plan_path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'plan bytes'):
            run.open_journal(self.root / 'state', self.plan_path, self.plan, ACCOUNT, FakeCloud.token)
        self.plan_path.write_text(json.dumps(self.plan))
        self.journal = run.open_journal(self.root / 'state', self.plan_path, self.plan, ACCOUNT, FakeCloud.token)
        self.journal.record('not-owned', candidate_database_id=None)
        with self.assertRaisesRegex(imp.ImportFailure, 'without this execution owning'):
            run.candidate(self.journal, FakeCloud(), self.plan)

    def test_active_staging_and_wrong_candidate_identity_are_rejected(self):
        with self.assertRaises(imp.ImportFailure):
            imp.validate_identity(imp.STAGING_DATABASE, {'uuid': imp.STAGING_DATABASE, 'name': NAME}, NAME)
        with self.assertRaises(imp.ImportFailure):
            imp.validate_identity(CANDIDATE, {'uuid': CANDIDATE, 'name': 'workshop-production'}, NAME)


if __name__ == '__main__':
    unittest.main()
