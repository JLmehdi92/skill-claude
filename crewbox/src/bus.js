import { EventEmitter } from 'node:events';

/** In-process event bus: runs, messages, notifications. The UI subscribes over SSE. */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export const emit = (type, data) => bus.emit('event', { type, data, at: Date.now() });
