import Gtk from 'gi://Gtk';

import Gio from 'gi://Gio';
const Settings = Gio.Settings;
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as settings from './settings.js';
import * as log from './log.js';
import * as focus from './focus.js';

interface AppWidgets {
    inner_gap: any;
    mouse_cursor_follows_active_window: any;
    outer_gap: any;
    show_skip_taskbar: any;
    snap_to_grid: any;
    mouse_cursor_focus_position: any;
    max_window_width: any;
}

export default class PopShellPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        globalThis.popShellExtension = this;
        let dialog = settings_dialog_new();
        if (dialog.show_all) {
            dialog.show_all();
        } else {
            dialog.show();
        }
        log.debug(JSON.stringify(dialog));
        return dialog;
    }
}

function settings_dialog_new(): Gtk.Container {
    let [app, grid] = settings_dialog_view();

    let ext = new settings.ExtensionSettings();

    app.snap_to_grid.set_active(ext.snap_to_grid());
    app.snap_to_grid.connect('state-set', (_widget: any, state: boolean) => {
        ext.set_snap_to_grid(state);
        Settings.sync();
    });

    app.outer_gap.set_text(String(ext.gap_outer()));
    app.outer_gap.connect('activate', (widget: any) => {
        let parsed = parseInt((widget.get_text() as string).trim());
        if (!isNaN(parsed)) {
            ext.set_gap_outer(parsed);
            Settings.sync();
        }
    });

    app.inner_gap.set_text(String(ext.gap_inner()));
    app.inner_gap.connect('activate', (widget: any) => {
        let parsed = parseInt((widget.get_text() as string).trim());
        if (!isNaN(parsed)) {
            ext.set_gap_inner(parsed);
            Settings.sync();
        }
    });

    app.show_skip_taskbar.set_active(ext.show_skiptaskbar());
    app.show_skip_taskbar.connect('state-set', (_widget: any, state: boolean) => {
        ext.set_show_skiptaskbar(state);
        Settings.sync();
    });

    app.mouse_cursor_follows_active_window.set_active(ext.mouse_cursor_follows_active_window());
    app.mouse_cursor_follows_active_window.connect('state-set', (_widget: any, state: boolean) => {
        ext.set_mouse_cursor_follows_active_window(state);
        Settings.sync();
    });

    app.mouse_cursor_focus_position.set_active(ext.mouse_cursor_focus_location());
    app.mouse_cursor_focus_position.connect('changed', () => {
        let active_id = app.mouse_cursor_focus_position.get_active_id();
        ext.set_mouse_cursor_focus_location(active_id);
    });

    app.max_window_width.set_text(String(ext.max_window_width()));
    app.max_window_width.connect('activate', (widget: any) => {
        let parsed = parseInt((widget.get_text() as string).trim());
        if (!isNaN(parsed)) {
            ext.set_max_window_width(parsed);
            Settings.sync();
        }
    });

    return grid;
}

function settings_dialog_view(): [AppWidgets, Gtk.Container] {
    const grid = new Gtk.Grid({
        column_spacing: 12,
        row_spacing: 12,
        margin_start: 10,
        margin_end: 10,
        margin_bottom: 10,
        margin_top: 10,
    });

    const snap_label = new Gtk.Label({
        label: 'Snap to Grid (Floating Mode)',
        xalign: 0.0,
    });

    const show_skip_taskbar_label = new Gtk.Label({
        label: 'Show Minimize to Tray Windows',
        xalign: 0.0,
    });

    const mouse_cursor_follows_active_window_label = new Gtk.Label({
        label: 'Mouse Cursor Follows Active Window',
        xalign: 0.0,
    });

    const max_window_width_label = new Gtk.Label({
        label: 'Max window width (in pixels); 0 to disable',
        xalign: 0.0,
    });

    const [inner_gap, outer_gap] = gaps_section(grid, 8);

    const settings = {
        inner_gap,
        outer_gap,
        snap_to_grid: new Gtk.Switch({ halign: Gtk.Align.END }),
        show_skip_taskbar: new Gtk.Switch({ halign: Gtk.Align.END }),
        mouse_cursor_follows_active_window: new Gtk.Switch({ halign: Gtk.Align.END }),
        mouse_cursor_focus_position: build_combo(grid, 6, focus.FocusPosition, 'Mouse Cursor Focus Position'),
        max_window_width: number_entry(),
    };

    grid.attach(snap_label, 0, 0, 1, 1);
    grid.attach(settings.snap_to_grid, 1, 0, 1, 1);

    grid.attach(show_skip_taskbar_label, 0, 4, 1, 1);
    grid.attach(settings.show_skip_taskbar, 1, 4, 1, 1);

    grid.attach(mouse_cursor_follows_active_window_label, 0, 5, 1, 1);
    grid.attach(settings.mouse_cursor_follows_active_window, 1, 5, 1, 1);

    grid.attach(max_window_width_label, 0, 11, 1, 1);
    grid.attach(settings.max_window_width, 1, 11, 1, 1);

    return [settings, grid];
}

function gaps_section(grid: any, top: number): [any, any] {
    let outer_label = new Gtk.Label({
        label: 'Outer',
        xalign: 0.0,
        margin_start: 24,
    });

    let outer_entry = number_entry();

    let inner_label = new Gtk.Label({
        label: 'Inner',
        xalign: 0.0,
        margin_start: 24,
    });

    let inner_entry = number_entry();

    let section_label = new Gtk.Label({
        label: 'Gaps (in pixels)',
        xalign: 0.0,
    });

    grid.attach(section_label, 0, top, 1, 1);
    grid.attach(outer_label, 0, top + 1, 1, 1);
    grid.attach(outer_entry, 1, top + 1, 1, 1);
    grid.attach(inner_label, 0, top + 2, 1, 1);
    grid.attach(inner_entry, 1, top + 2, 1, 1);

    return [inner_entry, outer_entry];
}

function number_entry(): Gtk.Widget {
    return new Gtk.Entry({ input_purpose: Gtk.InputPurpose.NUMBER });
}

function build_combo(grid: any, top_index: number, iter_enum: any, label: string) {
    let label_ = new Gtk.Label({
        label: label,
        halign: Gtk.Align.START,
    });

    grid.attach(label_, 0, top_index, 1, 1);

    let combo = new Gtk.ComboBoxText();

    for (const [index, key] of Object.keys(iter_enum).entries()) {
        if (typeof iter_enum[key] == 'string') {
            combo.append(`${index}`, iter_enum[key]);
        }
    }

    grid.attach(combo, 1, top_index, 1, 1);
    return combo;
}
