import { describe, expect, it } from 'vitest';
import { InputController, isFormControlTarget } from './inputController';

/*
 * Node has no DOM. These tests use EventTarget as the window and document, and a small
 * KeyboardEvent-shaped Event. The behavior exercised is the same listener logic the browser runs.
 */

class FakeKeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  constructor(type: 'keydown' | 'keyup', code: string, repeat = false, shiftKey = false) {
    super(type, { cancelable: true });
    this.code = code;
    this.repeat = repeat;
    this.shiftKey = shiftKey;
  }
}

class FakeElement extends EventTarget {
  readonly tagName: string;
  readonly isContentEditable: boolean;
  constructor(tagName: string, isContentEditable = false) {
    super();
    this.tagName = tagName;
    this.isContentEditable = isContentEditable;
  }
}

class FakeDocument extends EventTarget {
  hidden = false;
}

function setup() {
  const view = new EventTarget();
  const doc = new FakeDocument();
  const controller = new InputController();
  const detach = controller.attach(view, doc);
  const press = (code: string, repeat = false, shiftKey = false) => {
    const event = new FakeKeyEvent('keydown', code, repeat, shiftKey);
    view.dispatchEvent(event);
    return event;
  };
  const release = (code: string) => view.dispatchEvent(new FakeKeyEvent('keyup', code));
  return { view, doc, controller, detach, press, release };
}

describe('held-key tracking', () => {
  it('tracks keys as held from keydown until keyup', () => {
    const { controller, press, release } = setup();
    press('KeyW');
    expect(controller.sample().throttle).toBe(1);
    release('KeyW');
    expect(controller.sample().throttle).toBe(0);
  });

  it('keeps a key held across repeat keydown events', () => {
    const { controller, press } = setup();
    press('KeyD');
    press('KeyD', true);
    expect(controller.sample().steer).toBe(1);
  });

  it('clears all held keys on window blur', () => {
    const { view, controller, press } = setup();
    press('KeyW');
    press('KeyA');
    view.dispatchEvent(new Event('blur'));
    expect(controller.sample()).toEqual({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
    expect(controller.pressedKeys).toEqual([]);
  });

  it('clears all held keys when the tab becomes hidden', () => {
    const { doc, controller, press } = setup();
    press('KeyW');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(controller.sample().throttle).toBe(0);
  });

  it('reports tab visibility to the optional callback, through the one visibility listener', () => {
    const view = new EventTarget();
    const doc = new FakeDocument();
    const seen: boolean[] = [];
    const controller = new InputController();
    const detach = controller.attach(view, doc, { onVisibilityChange: (hidden) => seen.push(hidden) });
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual([true, false]);
    detach();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual([true, false]);
  });

  it('keeps held keys when the tab becomes visible again', () => {
    const { doc, controller, press } = setup();
    press('KeyW');
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(controller.sample().throttle).toBe(1);
  });

  it('prevents page scrolling for the handbrake and arrow keys', () => {
    const { press } = setup();
    expect(press('Space').defaultPrevented).toBe(true);
    expect(press('ArrowDown').defaultPrevented).toBe(true);
  });
});

describe('action queue', () => {
  it('queues pause on Escape once per press and ignores auto-repeat', () => {
    const { controller, press } = setup();
    press('Escape');
    press('Escape', true);
    expect(controller.consumeActions()).toEqual(['pause']);
    expect(controller.consumeActions()).toEqual([]);
  });

  it('queues reset and debug actions in order', () => {
    const { controller, press } = setup();
    press('KeyR');
    press('Backquote', false, true);
    expect(controller.consumeActions()).toEqual(['reset', 'debugPanel']);
  });

  it('ignores a plain backquote: the diagnostics panel needs Shift', () => {
    const { controller, press } = setup();
    press('Backquote');
    expect(controller.consumeActions()).toEqual([]);
  });

  it('accepts actions queued from UI controls', () => {
    const { controller } = setup();
    controller.queueAction('reset');
    expect(controller.consumeActions()).toEqual(['reset']);
  });

  it('caps the queue so an unconsumed backlog cannot grow without bound', () => {
    const { controller } = setup();
    for (let i = 0; i < 100; i += 1) controller.queueAction('reset');
    expect(controller.consumeActions().length).toBeLessThanOrEqual(16);
  });
});

describe('form-control suppression', () => {
  it('ignores driving keys aimed at a text input', () => {
    const input = new FakeElement('INPUT');
    const controller = new InputController();
    const detach = controller.attach(input);
    input.dispatchEvent(new FakeKeyEvent('keydown', 'KeyW'));
    expect(controller.sample().throttle).toBe(0);
    detach();
  });

  it('ignores driving keys aimed at a button, so Space does not drive while a menu has focus', () => {
    const button = new FakeElement('BUTTON');
    const controller = new InputController();
    const detach = controller.attach(button);
    const event = new FakeKeyEvent('keydown', 'Space');
    button.dispatchEvent(event);
    expect(controller.sample().handbrake).toBe(0);
    expect(event.defaultPrevented).toBe(false);
    detach();
  });

  it('still honors Escape while a form control has focus', () => {
    const button = new FakeElement('BUTTON');
    const controller = new InputController();
    const detach = controller.attach(button);
    button.dispatchEvent(new FakeKeyEvent('keydown', 'Escape'));
    expect(controller.consumeActions()).toEqual(['pause']);
    detach();
  });

  it('recognizes form controls and contenteditable elements', () => {
    expect(isFormControlTarget(new FakeElement('TEXTAREA'))).toBe(true);
    expect(isFormControlTarget(new FakeElement('DIV', true))).toBe(true);
    expect(isFormControlTarget(new FakeElement('CANVAS'))).toBe(false);
    expect(isFormControlTarget(null)).toBe(false);
  });
});

describe('listener lifecycle', () => {
  it('removes all listeners on detach, so later events do nothing', () => {
    const { view, doc, controller, press, detach } = setup();
    detach();
    press('KeyW');
    view.dispatchEvent(new Event('blur'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(controller.consumeActions()).toEqual([]);
    expect(controller.sample().throttle).toBe(0);
  });

  it('does not stack listeners when attached again after detach', () => {
    const { view, controller, press, detach } = setup();
    detach();
    const detachAgain = controller.attach(view);
    press('KeyR');
    expect(controller.consumeActions()).toEqual(['reset']);
    detachAgain();
  });
});
