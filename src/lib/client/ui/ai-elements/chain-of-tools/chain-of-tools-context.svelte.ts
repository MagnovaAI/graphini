import { getContext, setContext } from 'svelte';

const CHAIN_OF_TOOLS_CONTEXT_KEY = 'chain-of-tools-context';

export class ChainOfToolsContext {
  #isOpen = $state(false);
  #onOpenChange: ((open: boolean) => void) | undefined;

  constructor(
    options: {
      isOpen?: boolean;
      onOpenChange?: (open: boolean) => void;
    } = {}
  ) {
    this.#isOpen = options.isOpen ?? false;
    this.#onOpenChange = options.onOpenChange;
  }

  get isOpen() {
    return this.#isOpen;
  }

  set isOpen(value: boolean) {
    this.#isOpen = value;
    this.#onOpenChange?.(value);
  }

  syncOpen(value: boolean) {
    this.#isOpen = value;
  }

  setOnOpenChange(onOpenChange: ((open: boolean) => void) | undefined) {
    this.#onOpenChange = onOpenChange;
  }

  setIsOpen = (open: boolean) => {
    this.isOpen = open;
  };

  toggle() {
    this.isOpen = !this.isOpen;
  }
}

export function setChainOfToolsContext(context: ChainOfToolsContext) {
  setContext(CHAIN_OF_TOOLS_CONTEXT_KEY, context);
}

export function getChainOfToolsContext(): ChainOfToolsContext {
  const context = getContext<ChainOfToolsContext | undefined>(CHAIN_OF_TOOLS_CONTEXT_KEY);
  if (!context) {
    throw new Error('ChainOfTools components must be used within ChainOfTools');
  }
  return context;
}
