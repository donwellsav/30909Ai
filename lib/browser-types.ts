export interface BrowserUseElement {
  tag: string;
  label: string;
  selector: string;
}

export interface BrowserUseState {
  url: string;
  title: string;
  text: string;
  screenshot: string;
  elements: BrowserUseElement[];
}

export interface BrowserAction {
  action: "open" | "snapshot" | "click" | "type" | "back" | "forward" | "reload";
  url?: string;
  selector?: string;
  text?: string;
}

export interface BrowserActionLog {
  action: BrowserAction["action"];
  status: "ok" | "failed";
  url?: string;
  selector?: string;
  title?: string;
  error?: string;
}
