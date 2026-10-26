interface WorkshopWorldbookExtensions {
  cw_project_id?: unknown;
  cw_project_version?: unknown;
  cw_project_name_display?: string;
  cw_installed_hash?: unknown;
  cw_entry_key?: unknown;
  cw_entry_id?: unknown;
}

interface WorkshopWorldbookEntry {
  uid?: unknown;
  comment?: unknown;
  name?: unknown;
  content?: unknown;
  extensions?: WorkshopWorldbookExtensions;
}

interface WorkshopTavernRegex {
  id: string;
  script_name: string;
  enabled: boolean;
  scope: "character";
  find_regex: string;
  replace_string: string;
  trim_strings: unknown[];
  source?: {
    user_input: boolean;
    ai_output: boolean;
    slash_command: boolean;
    world_info: boolean;
    reasoning: boolean;
  };
  destination: { display: boolean; prompt: boolean };
  run_on_edit: boolean;
  min_depth: number | null;
  max_depth: number | null;
}

interface WorkshopJQueryCollection<ElementType extends Element = HTMLElement> {
  readonly 0: ElementType;
  readonly length: number;
  remove(): this;
  css(properties: Partial<{ [Key in keyof CSSStyleDeclaration]: string | number }>): this;
  append(...children: WorkshopJQueryCollection<Element>[]): this;
  appendTo(target: Element): this;
  on(event: "click", handler: (event: Event) => void): this;
  text(value: string): this;
  attr(name: "src", value: string): this;
  val(): string | number | string[] | undefined;
  val(value: string): this;
}

interface WorkshopJQuery {
  (selector: "<iframe frameborder='0'>"): WorkshopJQueryCollection<HTMLIFrameElement>;
  (selector: string): WorkshopJQueryCollection;
  (ready: () => void): void;
}

interface Window {
  $?: WorkshopJQuery;
}

declare const $: WorkshopJQuery;
declare const SillyTavern: { getCurrentCharacterName?: () => string | null };
declare function getScriptId(): string;
declare function getVariables(options: { type: "script"; script_id: string }): Record<string, unknown>;
declare function updateVariablesWith(
  updater: (variables: Record<string, unknown>) => Record<string, unknown>,
  options: { type: "script"; script_id: string },
): Promise<void>;
declare function getCharWorldbookNames(scope: "current"): { primary: string | null; additional: string[] };
declare function getWorldbookNames(): string[];
declare function getWorldbook(name: string): Promise<WorkshopWorldbookEntry[]>;
declare function createWorldbook(name: string, entries: WorkshopWorldbookEntry[]): Promise<void>;
declare function rebindCharWorldbooks(
  scope: "current",
  bindings: { primary: string | null; additional: string[] },
): Promise<void>;
declare function updateWorldbookWith(
  name: string,
  updater: (entries: WorkshopWorldbookEntry[]) => WorkshopWorldbookEntry[],
): Promise<WorkshopWorldbookEntry[]>;
declare function getTavernRegexes(options: { scope: "character"; enable_state: "all" }): WorkshopTavernRegex[];
declare function updateTavernRegexesWith(
  updater: (regexes: WorkshopTavernRegex[]) => WorkshopTavernRegex[],
  options: { scope: "character" },
): Promise<WorkshopTavernRegex[]>;

declare const __CW_CLIENT_VERSION__: string;
declare const __CW_DEFAULT_ORIGIN__: string;
