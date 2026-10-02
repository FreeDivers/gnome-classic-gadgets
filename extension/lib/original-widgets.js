// SPDX-License-Identifier: MIT
import {_, format} from './i18n.js';
// Index of the original-skin gadget adapters. Each gadget lives in lib/gadgets/<type>.js
// (phase-2 agents edit only their own file); the base class and St helpers are in
// lib/gadget.js. The exports below keep the names older code and tests reference.
import {GADGETS} from './core.js';
import Clock from './gadgets/clock.js';
import Calendar from './gadgets/calendar.js';
import System from './gadgets/system.js';
import Notes from './gadgets/notes.js';
import Weather from './gadgets/weather.js';
import Photos from './gadgets/photos.js';
import Calculator from './gadgets/calculator.js';
import Timer from './gadgets/timer.js';
import Puzzle from './gadgets/puzzle.js';
import Feed from './gadgets/rss.js';
import Currency from './gadgets/currency.js';
import Stocks from './gadgets/stocks.js';
import Contacts from './gadgets/contacts.js';
import Trash from './gadgets/trash.js';

export {TOOLBAR_WIDTH, FOLDERS, label, place, action, surface, Gadget} from './gadget.js';
export {NetworkGadget} from './gadgets/network-gadget.js';
export {CLOCK_FACES} from './gadgets/clock.js';

export const CLASSES = Object.freeze({clock: Clock, calendar: Calendar, system: System, notes: Notes, weather: Weather, photos: Photos, calculator: Calculator, timer: Timer, puzzle: Puzzle, rss: Feed, currency: Currency, stocks: Stocks, contacts: Contacts, trash: Trash});
export function createGadget(host, type) {
    if (!Object.hasOwn(CLASSES, type) || !Object.hasOwn(GADGETS, type)) throw new Error(format(_("Unknown widget: {type}"), {type: type}));
    const widget = new CLASSES[type](host, type);
    try { return widget.init(); } catch (e) { widget.destroy(); throw e; }
}
