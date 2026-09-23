import * as lib from './lib.js';

import GLib from 'gi://GLib';

export function get_window_role(xid: string): string | null {
    let out = xprop_cmd(xid, 'WM_WINDOW_ROLE');

    if (!out) return null;

    return parse_string(out);
}

function size_params(line: string): [number, number] | null {
    let fields = line.split(' ');
    let x = lib.dbg(lib.nth_rev(fields, 2));
    let y = lib.dbg(lib.nth_rev(fields, 0));

    if (!x || !y) return null;

    let xn = parseInt(x, 10);
    let yn = parseInt(y, 10);

    return isNaN(xn) || isNaN(yn) ? null : [xn, yn];
}

export function get_size_hints(xid: string): lib.SizeHint | null {
    let out = xprop_cmd(xid, 'WM_NORMAL_HINTS');
    if (out) {
        let lines = out.split('\n')[Symbol.iterator]();
        lines.next();

        let minimum: string | undefined = lines.next().value;
        let increment: string | undefined = lines.next().value;
        let base: string | undefined = lines.next().value;

        if (!minimum || !increment || !base) return null;

        let min_values = size_params(minimum);
        let inc_values = size_params(increment);
        let base_values = size_params(base);

        if (!min_values || !inc_values || !base_values) return null;

        return {
            minimum: min_values,
            increment: inc_values,
            base: base_values,
        };
    }

    return null;
}

export function get_xid(meta: Meta.Window): string | null {
    const desc = meta.get_description();
    const match = desc && desc.match(/0x[0-9a-f]+/);
    return match && match[0];
}

function consume_key(string: string): number | null {
    const pos = string.indexOf('=');
    return -1 == pos ? null : pos;
}

function parse_string(string: string): string | null {
    const pos = consume_key(string);
    return pos
        ? string
              .slice(pos + 1)
              .trim()
              .slice(1, -1)
        : null;
}

function xprop_cmd(xid: string, args: string): string | null {
    let xprops = GLib.spawn_command_line_sync(`xprop -id ${xid} ${args}`);
    if (!xprops[0]) return null;

    return imports.byteArray.toString(xprops[1]);
}
