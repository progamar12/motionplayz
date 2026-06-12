interface PresentationConnection {
  state: 'connected' | 'closed' | 'connecting' | 'terminated';
  close: () => void;
  send: (data: string) => void;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onconnect: (() => void) | null;
  onclose: (() => void) | null;
}

interface PresentationConnectionList {
  connections: PresentationConnection[];
  onconnectionavailable: (() => void) | null;
  addEventListener(type: string, listener: (ev: Event) => void): void;
  removeEventListener(type: string, listener: (ev: Event) => void): void;
}

interface PresentationReceiver {
  connectionList: Promise<PresentationConnectionList>;
}

interface Presentation {
  receiver?: PresentationReceiver;
}

interface PresentationRequest {
  start(): Promise<PresentationConnection>;
  getAvailability(): Promise<PresentationAvailability>;
  onconnectionavailable: ((ev: Event) => void) | null;
}

interface PresentationAvailability {
  value: boolean;
  onchange: ((ev: Event) => void) | null;
}

interface Navigator {
  presentation?: Presentation;
}

declare var PresentationRequest: {
  prototype: PresentationRequest;
  new(urls: string | string[]): PresentationRequest;
};

declare var Presentation: {
  prototype: Presentation;
  new(): Presentation;
};
