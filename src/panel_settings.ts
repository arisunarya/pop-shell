import type { Ext } from './extension.js';

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {
    PopupBaseMenuItem,
    PopupMenuItem,
    PopupSeparatorMenuItem,
} from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import GLib from 'gi://GLib';
import { spawn } from 'resource:///org/gnome/shell/misc/util.js';
import { get_current_path } from './paths.js';
import { MAX_GAP, MIN_GAP } from './settings.js';

export var TileToggle = GObject.registerClass(
    class TileToggle extends QuickSettings.QuickMenuToggle {
        ext: any;

        _init(ext: Ext) {
            const path = get_current_path();
            if (!ext.button_gio_icon_auto_on) {
                ext.button_gio_icon_auto_on = Gio.icon_new_for_string(
                    `${path}/icons/pop-shell-auto-on-symbolic.svg`,
                );
                ext.button_gio_icon_auto_off = Gio.icon_new_for_string(
                    `${path}/icons/pop-shell-auto-off-symbolic.svg`,
                );
            }

            const active = null != ext.auto_tiler || ext.settings.tile_by_default();

            super._init({
                title: _('Tile Windows'),
                subtitle: active ? _('Tiling') : _('Floating'),
                gicon: active ? ext.button_gio_icon_auto_on : ext.button_gio_icon_auto_off,
                toggleMode: true,
            });

            this.ext = ext;
            // Keep Ext.button pointing at the toggle for icon sync in Ext.auto_tile_on/off
            ext.button = this;

            this.checked = active;

            this.menu.setHeader(
                active ? ext.button_gio_icon_auto_on : ext.button_gio_icon_auto_off,
                _('Tile Windows'),
                active ? _('Tiling') : _('Floating'),
            );

            // Dropdown content, moved from the old top-bar menu:
            // Floating exceptions, Shortcuts, Active Hint Color, Gaps.
            this.menu.addMenuItem(floating_window_exceptions(ext, this.menu));
            this.menu.addMenuItem(menu_separator(''));
            this.menu.addMenuItem(shortcuts(this.menu));
            this.menu.addMenuItem(menu_separator(''));
            this.menu.addMenuItem(color_selector(ext, this.menu));
            this.menu.addMenuItem(
                number_entry(
                    _('Gaps'),
                    {
                        value: Math.min(Math.max(ext.settings.gap_inner(), MIN_GAP), MAX_GAP),
                        min: MIN_GAP,
                        max: MAX_GAP,
                    },
                    (value) => {
                        ext.settings.set_gap_inner(value);
                        ext.settings.set_gap_outer(value);
                    },
                ),
            );

            this.connect('clicked', () => {
                if (this.checked) {
                    ext.auto_tile_on();
                } else {
                    ext.auto_tile_off();
                }
            });
        }

        sync(active: boolean) {
            if (this.checked !== active) {
                this.checked = active;
            }
            const gicon = active ? this.ext.button_gio_icon_auto_on : this.ext.button_gio_icon_auto_off;
            this.gicon = gicon;
            const subtitle = active ? _('Tiling') : _('Floating');
            this.subtitle = subtitle;
            this.menu.setHeader(gicon, _('Tile Windows'), subtitle);
        }

        // Compat for old indicator.toggle_tiled.setToggleState(bool) callers
        setToggleState(active: boolean) {
            this.sync(active);
        }
    },
);

export var Indicator = GObject.registerClass(
    class Indicator extends QuickSettings.SystemIndicator {
        toggle: any;
        // Compat alias: old code used indicator.toggle_tiled.setToggleState(bool)
        toggle_tiled: any;
        entry_gaps: any;

        _indicator: any;

        _init(ext: Ext) {
            super._init();

            const path = get_current_path();
            ext.button_gio_icon_auto_on = Gio.icon_new_for_string(
                `${path}/icons/pop-shell-auto-on-symbolic.svg`,
            );
            ext.button_gio_icon_auto_off = Gio.icon_new_for_string(
                `${path}/icons/pop-shell-auto-off-symbolic.svg`,
            );

            this._indicator = this._addIndicator();
            this._indicator.gicon =
                ext.settings.tile_by_default() || null != ext.auto_tiler
                    ? ext.button_gio_icon_auto_on
                    : ext.button_gio_icon_auto_off;

            this.toggle = new TileToggle(ext);
            this.toggle_tiled = this.toggle;
            this.quickSettingsItems.push(this.toggle);
        }

        setTileActive(active: boolean) {
            this.toggle.sync(active);
            this._indicator.gicon = active
                ? this.toggle.ext.button_gio_icon_auto_on
                : this.toggle.ext.button_gio_icon_auto_off;
        }

        destroy() {
            this.quickSettingsItems.forEach((item: any) => item.destroy());
            super.destroy();
        }
    },
);

function menu_separator(text: any): any {
    return new PopupSeparatorMenuItem(text);
}

function shortcuts(menu: any): any {
    let label = new St.Label({ text: _('Shortcuts') });
    label.set_x_expand(true);

    let icon = new St.Icon({ icon_name: 'go-next-symbolic', icon_size: 16 });
    icon.set_style('margin-left: 8px;');

    let widget = new St.BoxLayout({ vertical: false });
    widget.add_child(label);
    widget.add_child(icon);
    widget.set_x_expand(true);

    let item = new PopupBaseMenuItem();
    item.add_child(widget);
    item.connect('activate', () => {
        let path: string | null = GLib.find_program_in_path('pop-shell-shortcuts');
        if (path) {
            spawn([path]);
        } else {
            spawn(['xdg-open', 'https://support.system76.com/articles/pop-keyboard-shortcuts/']);
        }

        menu.close();
    });

    return item;
}

function floating_window_exceptions(ext: Ext, menu: any): any {
    let label = new St.Label({ text: 'Floating Window Exceptions' });
    label.set_x_expand(true);

    let icon = new St.Icon({ icon_name: 'go-next-symbolic', icon_size: 16 });
    icon.set_style('margin-left: 8px;');

    let widget = new St.BoxLayout({ vertical: false });
    widget.add_child(label);
    widget.add_child(icon);
    widget.set_x_expand(true);

    let base = new PopupBaseMenuItem();
    base.add_child(widget);
    base.connect('activate', () => {
        ext.exception_dialog();

        GLib.timeout_add(GLib.PRIORITY_LOW, 300, () => {
            menu.close();
            return false;
        });
    });

    return base;
}

function clamp(input: number, min = 0, max = 128): number {
    return Math.min(Math.max(min, input), max);
}

function number_entry(
    label: string,
    valueOrOptions: number | { value: number; min: number; max: number },
    callback: (a: number) => void,
): any {
    let value = valueOrOptions,
        min: number,
        max: number;
    if (typeof valueOrOptions !== 'number') ({ value, min, max } = valueOrOptions);

    const entry = new St.Entry({
        text: String(value),
        input_purpose: Clutter.InputContentPurpose.NUMBER,
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: false,
    });

    entry.set_style('width: 5em');
    entry.connect('button-release-event', () => {
        return true;
    });

    const text = entry.clutter_text;
    text.set_max_length(2);

    entry.connect('key-release-event', (_: any, event: any) => {
        const symbol = event.get_key_symbol();

        const number: number | null =
            symbol == 65293 // enter key
                ? parse_number(text.text)
                : symbol == 65361 // left key
                ? clamp(parse_number(text.text) - 1, min, max)
                : symbol == 65363 // right key
                ? clamp(parse_number(text.text) + 1, min, max)
                : null;

        if (number !== null) {
            text.set_text(String(number));
        }
    });

    const create_icon = (icon_name: string) => {
        return new St.Icon({ icon_name, icon_size: 16 });
    };

    entry.set_primary_icon(create_icon('value-decrease'));
    entry.connect('primary-icon-clicked', () => {
        text.set_text(String(clamp(parseInt(text.get_text()) - 1, min, max)));
    });

    entry.set_secondary_icon(create_icon('value-increase'));
    entry.connect('secondary-icon-clicked', () => {
        text.set_text(String(clamp(parseInt(text.get_text()) + 1, min, max)));
    });

    text.connect('text-changed', () => {
        const input: string = text.get_text();
        let parsed = parseInt(input);

        if (isNaN(parsed)) {
            text.set_text(input.substr(0, input.length - 1));
            parsed = 0;
        }

        callback(clamp(parsed, min ?? 0, max ?? 128));
    });

    const item = new PopupMenuItem(label);
    item.label.get_clutter_text().set_x_expand(true);
    item.label.set_y_align(Clutter.ActorAlign.CENTER);
    item.add_child(entry);

    return item;
}

function parse_number(text: string): number {
    let number = parseInt(text, 10);
    if (isNaN(number)) {
        number = 0;
    }

    return number;
}

function color_selector(ext: Ext, menu: any) {
    let color_selector_item = new PopupMenuItem('Active Hint Color');
    let color_button = new St.Button();
    let settings = ext.settings;
    let selected_color = settings.hint_color_rgba();

    // TODO, find a way to expand the button text, :)
    color_button.label = '           '; // blank for now
    color_button.set_style(`background-color: ${selected_color}; border: 2px solid lightgray; border-radius: 2px`);

    settings.ext.connect('changed', (_, key) => {
        if (key === 'hint-color-rgba') {
            let color_value = settings.hint_color_rgba();
            color_button.set_style(`background-color: ${color_value}; border: 2px solid lightgray; border-radius: 2px`);
        }
    });

    color_button.set_x_align(Clutter.ActorAlign.END);
    color_button.set_x_expand(false);

    color_selector_item.label.get_clutter_text().set_x_expand(true);
    color_selector_item.label.set_y_align(Clutter.ActorAlign.CENTER);

    color_selector_item.add_child(color_button);
    color_button.connect('button-press-event', () => {
        let path = get_current_path() + '/color_dialog/main.js';
        let resp = GLib.spawn_command_line_async(`gjs --module ${path}`);
        if (!resp) {
            return null;
        }

        // clean up and focus on the color dialog
        GLib.timeout_add(GLib.PRIORITY_LOW, 300, () => {
            menu.close();
            return false;
        });
    });

    return color_selector_item;
}
