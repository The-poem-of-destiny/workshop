"""Resume plan-bound candidate imports without touching the active staging database."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


imp = module('full-d1-import')
budget = module('multiday-budget')


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


class Cloud:
    def __init__(self, account, token, journal):
        self.account, self.token, self.journal = account, token, journal
        self.opener = urllib.request.build_opener(imp.NoRedirect())

    def request(self, suffix, payload=None):
        request = urllib.request.Request(
            imp.API + '/accounts/' + self.account + '/d1/database' + suffix,
            data=None if payload is None else json.dumps(payload).encode(),
            method='GET' if payload is None else 'POST',
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'},
        )
        try:
            with self.opener.open(request, timeout=90) as response:
                body = json.load(response)
            if body.get('success') is not True:
                raise ValueError('Cloudflare rejected request')
            return body['result']
        except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as error:
            raise imp.ImportFailure('D1 control request failed; inspect durable operation intent before retrying') from error

    def identity(self, database, name):
        result = self.request('/' + database)
        imp.validate_identity(database, result, name)
        return result

    def discover(self, name):
        rows = self.request('?per_page=100&name=' + name)
        if not isinstance(rows, list):
            raise imp.ImportFailure('candidate discovery returned an invalid inventory')
        matches = [row for row in rows if row.get('name') == name]
        if len(matches) > 1:
            raise imp.ImportFailure('candidate name is ambiguous')
        return matches[0] if matches else None

    def query(self, database, sql):
        statement = sql.strip().rstrip(';')
        if ';' in statement or not re.match(r'(?is)^(SELECT\b|PRAGMA\s+(?:foreign_key_check|integrity_check)\b)', statement):
            raise ValueError('snapshot adapter permits only single read-only queries')
        result = self.request('/' + database + '/query', {'sql': sql})
        if not isinstance(result, list) or len(result) != 1 or result[0].get('success') is not True:
            raise imp.ImportFailure('read-only D1 query rejected')
        rows = result[0].get('results')
        if not isinstance(rows, list):
            raise imp.ImportFailure('read-only query returned no rows array')
        return rows


def checked_plan(path):
    planner = module('multiday-plan')
    result = planner.validate_plan(Path(path).resolve())
    if not isinstance(result, dict):
        raise ValueError('plan validator returned an invalid plan')
    return result


def public_status(state):
    return {key: state.get(key) for key in (
        'plan_id', 'candidate_name', 'candidate_database_id', 'phase', 'next_batch',
        'batch_count', 'next_attempt_at', 'budget', 'pending', 'verified_at', 'failure',
    )}


def open_journal(path, plan_path, plan, account, token):
    path = imp.outside_repository(path)
    if path.exists():
        journal = imp.Journal(path, token)
        expected = {'plan_id': plan['plan_id'], 'plan_sha256': digest(plan_path), 'account_id': account}
        if any(journal.state.get(key) != value for key, value in expected.items()):
            journal.close()
            raise ValueError('plan bytes or credential account differ from saved execution')
        return journal
    path.parent.mkdir(parents=True, exist_ok=True)
    journal = imp.Journal(path, token, create=True)
    journal.record('initialized', version=1, plan_id=plan['plan_id'], plan_sha256=digest(plan_path),
                   account_id=account, candidate_name=plan['candidate_name'], candidate_database_id=None,
                   phase='prepared', next_batch=0, batch_count=len(plan['batches']), ledger={}, pending=None)
    return journal


def allowance(journal, account, token, charge):
    usage = budget.analytics(account, token)
    ledger = dict(journal.state.get('ledger', {}))
    budget.observe(ledger, usage)
    result = budget.decide(usage, ledger, charge)
    journal.record('budget-observed', usage, budget=result, ledger=ledger)
    if not result['allowed']:
        journal.record('waiting-budget', phase='waiting_budget', next_attempt_at=result['next_attempt_at'])
    return result['allowed']


def candidate(journal, cloud, plan):
    name = plan['candidate_name']
    database = journal.state.get('candidate_database_id')
    if database:
        cloud.identity(database, name)
        return database
    existing = cloud.discover(name)
    if existing:
        intent = journal.state.get('candidate_create_intent')
        if not intent:
            raise imp.ImportFailure('candidate already exists without this execution owning its creation')
        created = existing.get('created_at')
        if not isinstance(created, str):
            raise imp.ImportFailure('ambiguous candidate creation has no server creation timestamp')
        if dt.datetime.fromisoformat(created.replace('Z', '+00:00')) < dt.datetime.fromisoformat(intent):
            raise imp.ImportFailure('candidate predates this execution')
        database = existing.get('uuid')
        cloud.identity(database, name)
        journal.record('candidate-recovered', candidate_database_id=database, phase='candidate_created')
        return database
    if journal.state.get('candidate_create_intent'):
        raise imp.ImportFailure('candidate creation outcome is unresolved; no second create request permitted')
    if not allowance(journal, cloud.account, cloud.token, 128):
        return None
    ledger = dict(journal.state['ledger'])
    day = budget.reserve(ledger, 128)
    journal.record('candidate-create-requested', phase='candidate_create_unknown', ledger=ledger,
                   candidate_create_intent=budget.utc_now().isoformat(), candidate_create_day=day)
    result = cloud.request('', {'name': name})
    database = result.get('uuid') if isinstance(result, dict) else None
    if not database or str(uuid.UUID(database)) != database:
        raise imp.ImportFailure('candidate creation returned no valid UUID')
    cloud.identity(database, name)
    journal.record('candidate-created', candidate_database_id=database, phase='candidate_created')
    return database


def finish_batch(journal, pending, result):
    if result.get('outcome') != 'complete' or result.get('ok') is not True:
        journal.record('batch-failed', phase='failed', failure='import_terminal_error')
        raise imp.ImportFailure('candidate batch failed; retained state is not automatically replayed')
    actual = result.get('statistics', {}).get('rows_written')
    ledger = dict(journal.state['ledger'])
    # Missing accounting is uncertainty: keep the full reservation and stop new writes.
    if isinstance(actual, bool) or not isinstance(actual, int) or actual < 0:
        journal.record('accounting-unavailable', phase='failed', failure='successful_import_missing_write_accounting')
        raise imp.ImportFailure('completed import lacks authoritative write accounting')
    budget.settle(ledger, pending['day'], pending['reserved'], actual)
    journal.record('batch-completed', result, phase='loading', next_batch=pending['index'] + 1,
                   pending=None, ledger=ledger, next_attempt_at=None)


def resume_pending(journal, plan):
    pending = journal.state.get('pending')
    if not pending:
        return
    index = pending['index']
    if (index != journal.state['next_batch'] or not 0 <= index < len(plan['batches'])
            or pending['sha256'] != plan['batches'][index]['sha256']
            or pending['id'] != plan['batches'][index]['id']):
        raise imp.ImportFailure('pending operation differs from the frozen batch ordering')
    receipts = Path(pending['receipts'])
    unstarted = not receipts.exists() or not list(receipts.glob('[0-9]*-*.json'))
    if unstarted:
        # Even a partial input.sql is pre-request evidence. Preserve it, but
        # never mistake missing numbered receipts plus state.json for safety.
        if receipts.exists():
            imp.check_private(receipts, directory=True)
            for path in receipts.iterdir():
                imp.check_private(path)
                if path.name not in ('.lock', 'input.sql') and not path.name.startswith('.receipt-'):
                    raise imp.ImportFailure('missing numbered import receipts with unexplained local evidence')
    else:
        saved = imp.Journal(receipts, journal.token)
        try:
            if (saved.state.get('file', {}).get('sha256') != pending['sha256']
                    or saved.state.get('database_id') != journal.state['candidate_database_id']
                    or saved.state.get('candidate_name') != journal.state['candidate_name']):
                raise imp.ImportFailure('saved import differs from the frozen batch or candidate')
            unstarted = (saved.state.get('phase') in {
                'prepared', 'target_requested', 'target_received', 'target_unknown', 'target_validated'
            } and not saved.state.get('at_bookmark') and not saved.state.get('outcome'))
        finally:
            saved.close()
    if unstarted:
        ledger = {day: dict(value) for day, value in journal.state['ledger'].items()}
        ledger[pending['day']]['charged'] -= pending['reserved']
        if ledger[pending['day']]['charged'] < 0:
            raise imp.ImportFailure('unstarted reservation does not match the durable ledger')
        attempts = dict(journal.state.get('attempts', {}))
        attempts[str(index)] = attempts.get(str(index), 0) + 1
        journal.record('batch-proven-unstarted', phase='loading', pending=None,
                       ledger=ledger, attempts=attempts, failure=None)
        return
    result = imp.saved_status(receipts, resume=True)
    finish_batch(journal, pending, result)


def advance(journal, cloud, plan_path, plan, maximum):
    if journal.state.get('phase') in ('failed', 'candidate_create_unknown') and not journal.state.get('pending'):
        if journal.state.get('phase') == 'failed':
            raise imp.ImportFailure('execution is failed; preserve evidence and investigate, do not replay automatically')
    database = candidate(journal, cloud, plan)
    if not database:
        return False
    resume_pending(journal, plan)
    for _ in range(maximum):
        index = journal.state['next_batch']
        if index == len(plan['batches']):
            journal.record('loaded', phase='loaded', next_attempt_at=None)
            return True
        batch = plan['batches'][index]
        charge = budget.charge_for(batch)
        if not allowance(journal, cloud.account, cloud.token, charge):
            return False
        ledger = dict(journal.state['ledger'])
        day = budget.reserve(ledger, charge)
        sql = Path(plan_path).parent / batch['file']
        if digest(sql) != batch['sha256']:
            raise ValueError('SQL changed after plan verification')
        attempt = journal.state.get('attempts', {}).get(str(index), 0)
        pending = {'index': index, 'id': batch['id'], 'sha256': batch['sha256'], 'day': day,
                   'reserved': charge, 'receipts': str(journal.directory / f'batch-{index:05d}-attempt-{attempt:03d}')}
        journal.record('batch-requested', phase='batch_unknown', ledger=ledger, pending=pending)
        result = imp.execute(database, sql, pending['receipts'], candidate_name=plan['candidate_name'])
        finish_batch(journal, pending, result)
    return journal.state['next_batch'] == len(plan['batches'])


def compare_search(expected, actual):
    result = {}
    for table in ('project_search', 'project_search_short'):
        columns = [row[1] for row in expected.execute('PRAGMA table_info(' + table + ')')]
        expressions = ', '.join('f.' + imp_quote(column) for column in columns)
        sql = ('SELECT p.id, ' + expressions + ' FROM ' + table +
               ' f JOIN projects p ON p.rowid=f.rowid ORDER BY p.id')
        result[table] = list(expected.execute(sql)) == list(actual.execute(sql))
    sql = 'SELECT project_id,tag FROM project_search_tags ORDER BY project_id,tag'
    result['project_search_tags'] = list(expected.execute(sql)) == list(actual.execute(sql))
    return result


def imp_quote(value):
    return '"' + value.replace('"', '""') + '"'


def verify_ledger(cloud, database, plan):
    planner = module('multiday-plan')
    rows = cloud.query(database, 'SELECT id,name,applied_at FROM d1_migrations ORDER BY id')
    definitions = cloud.query(database, "SELECT type,name,sql FROM sqlite_schema WHERE tbl_name='d1_migrations' ORDER BY type,name")
    if [[row['type'], row['name'], row['sql']] for row in definitions] != plan['migration_ledger']['schema']:
        return False
    db = sqlite3.connect(':memory:')
    try:
        db.execute(planner.LEDGER_CREATE_SQL)
        db.executemany('INSERT INTO d1_migrations(id,name,applied_at) VALUES (?,?,?)',
                       [(row['id'], row['name'], row['applied_at']) for row in rows])
        return planner.validate_ledger(db, plan['inputs']['migrations']) == plan['migration_ledger']
    finally:
        db.close()


def verify(journal, cloud, plan_path, plan):
    if journal.state.get('pending') or journal.state['next_batch'] != len(plan['batches']):
        raise ValueError('candidate is not fully loaded')
    database = journal.state['candidate_database_id']
    cloud.identity(database, plan['candidate_name'])
    usage = budget.analytics(cloud.account, cloud.token)
    ledger = dict(journal.state.get('ledger', {}))
    budget.observe(ledger, usage)
    journal.record('verification-budget-observed', usage, ledger=ledger)
    if ledger[usage['day']]['observed_read'] >= budget.ACCOUNT_READ_CEILING:
        journal.record('verification-waiting-read-budget', phase='waiting_verification', next_attempt_at=budget.next_window())
        return False
    stage, loader = module('d1-data'), module('full-load')
    expected_schema = {(entry['type'], entry['name']): ' '.join(entry['sql'].split()) for entry in plan['schema']}
    migrations = Path(plan['inputs']['migrations'][0]['path']).parent
    snapshot = journal.directory / ('candidate-snapshot-' + str(journal.sequence + 1) + '.sqlite')
    old_mask = os.umask(0o077)
    try:
        actual = stage.snapshot(lambda sql: cloud.query(database, sql), migrations, snapshot, expected_schema)
    finally:
        os.umask(old_mask)
    expected_path = Path(plan_path).parent / 'expected.sqlite'
    expected = sqlite3.connect(expected_path.as_uri() + '?mode=ro', uri=True)
    original = json.loads((Path(plan_path).parent / 'preparation.json').read_text())
    comparison = dict(original, tables={key: value for key, value in original['tables'].items() if key != 'site_settings'})
    try:
        reconciled = loader.reconcile(comparison, snapshot)
        search = compare_search(expected, actual)
        source = loader.source_reconcile(original, Path(plan['inputs']['source']['path']), Path(plan['inputs']['manifest']['path']))
        migration_ledger = verify_ledger(cloud, database, plan)
        result = {'ok': reconciled.get('ok') is True and source.get('ok') is True and all(search.values()),
                  'reconciliation': reconciled, 'source_reconciliation': source, 'search': search,
                  'schema': stage.schema(actual) == expected_schema, 'snapshot_sha256': digest(snapshot)}
        result['migration_ledger'] = migration_ledger
        result['ok'] = result['ok'] and result['schema'] and migration_ledger
    finally:
        actual.close()
        expected.close()
    imp.atomic_json(journal.directory / ('verification-' + str(journal.sequence + 1) + '.json'), result)
    journal.record('candidate-verified' if result['ok'] else 'candidate-verification-failed',
                   phase='verified' if result['ok'] else 'failed',
                   verified_at=budget.utc_now().isoformat() if result['ok'] else None)
    if not result['ok']:
        raise imp.ImportFailure('candidate failed independent verification; active staging remains unchanged')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('advance', 'watch', 'verify', 'status'))
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--confirm-staging', action='store_true')
    parser.add_argument('--max-batches', type=int, default=10)
    args = parser.parse_args()
    if not 1 <= args.max_batches <= 100:
        parser.error('--max-batches must be between1 and100')
    journal = None
    try:
        plan = checked_plan(args.plan)
        account, token = imp.credentials()
        if args.command != 'status' and not args.confirm_staging:
            raise ValueError('explicit --confirm-staging required')
        journal = open_journal(args.state_dir, args.plan, plan, account, token)
        cloud = Cloud(account, token, journal)
        if args.command == 'status':
            print(json.dumps(public_status(journal.state), ensure_ascii=True))
            return 0
        while True:
            if args.command == 'verify':
                ready = verify(journal, cloud, args.plan.resolve(), plan)
            else:
                ready = advance(journal, cloud, args.plan.resolve(), plan, args.max_batches)
                if ready:
                    ready = verify(journal, cloud, args.plan.resolve(), plan)
            print(json.dumps(public_status(journal.state), ensure_ascii=True), flush=True)
            if args.command != 'watch' or ready:
                return 0 if ready else 75
            next_attempt = journal.state.get('next_attempt_at')
            if not next_attempt:
                continue
            delay = (dt.datetime.fromisoformat(next_attempt) - budget.utc_now()).total_seconds()
            print(json.dumps({'waiting_until': next_attempt, 'reason': 'daily_account_budget'}), flush=True)
            time.sleep(max(1, delay))
            # Revalidate every byte before the next day, not just at process startup.
            plan = checked_plan(args.plan)
    except (ValueError, RuntimeError, OSError, KeyError, sqlite3.Error) as error:
        print('multiday-staging: ' + imp.sanitize_text(str(error)), file=sys.stderr)
        return 1
    finally:
        if journal is not None:
            journal.close()


if __name__ == '__main__':
    raise SystemExit(main())
