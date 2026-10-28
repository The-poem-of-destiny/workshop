type WorkshopHostRow = import("./install-model.js").Row;

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
declare const SillyTavern: {
  getCurrentCharacterName?: () => string | null;
  getContext(): { characterId: number; characters?: { avatar?: string }[] };
};
declare function getScriptId(): string;
declare function getVariables(options: { type: "script"; script_id: string }): Record<string, unknown>;
declare function updateVariablesWith(
  updater: (variables: Record<string, unknown>) => Record<string, unknown>,
  options: { type: "script"; script_id: string },
): Promise<void>;
declare function getCharWorldbookNames(scope: "current"): { primary: string | null; additional: string[] };
declare function getWorldbookNames(): string[];
declare function getWorldbook(name: string): Promise<WorkshopHostRow[]>;
declare function createWorldbook(name: string, entries: WorkshopHostRow[]): Promise<void>;
declare function rebindCharWorldbooks(
  scope: "current",
  bindings: { primary: string | null; additional: string[] },
): Promise<void>;
declare function updateWorldbookWith(
  name: string,
  updater: (entries: WorkshopHostRow[]) => WorkshopHostRow[],
): Promise<WorkshopHostRow[]>;
declare function getTavernRegexes(options: { type: "character"; enable_state: "all" }): WorkshopHostRow[];
declare function updateTavernRegexesWith(
  updater: (regexes: WorkshopHostRow[]) => WorkshopHostRow[],
  options: { type: "character" },
): Promise<WorkshopHostRow[]>;

declare const __CW_CLIENT_VERSION__: string;
declare const __CW_DEFAULT_ORIGIN__: string;
