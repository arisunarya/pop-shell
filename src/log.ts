export function log(text: string) {
    (globalThis as any).log('pop-shell: ' + text);
}

export function error(text: string) {
    log('[ERROR] ' + text);
}

export function warn(text: string) {
    log('[WARN] ' + text);
}

export function info(text: string) {
    log('[INFO] ' + text);
}

export function debug(_text: string) {}
