import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
    appointmentRecordDate, appointmentDateKey, createAppointmentCalendarState,
    moveAppointmentMonth, appointmentMonth, appointmentDaySlots
} from '../js/features/appointmentCalendar.js';

const booking = (extra = {}) => ({ id: 'one', ownerId: 'owner', date: '2026-11-10', time: '08:00', customerName: 'Alex', status: 'pending', ...extra });
const november = { year: 2026, month: 10, selectedDay: null };
const dayRecords = records => appointmentDaySlots(records, '2026-11-10').flatMap(slot => slot.records);
const monthRecords = records => appointmentMonth(records, november).days.flatMap(day => day.records);

test('initializes using browser-local current month even on day 31', () => {
    assert.deepEqual(createAppointmentCalendarState(new Date(2026, 0, 31)), { year: 2026, month: 0, selectedDay: null });
});
for (const [name, state, delta, year, month] of [
    ['next month', { year: 2026, month: 0 }, 1, 2026, 1],
    ['previous month', { year: 2026, month: 2 }, -1, 2026, 1],
    ['December to January', { year: 2026, month: 11 }, 1, 2027, 0],
    ['January to December', { year: 2026, month: 0 }, -1, 2025, 11]
]) test(name, () => assert.deepEqual(moveAppointmentMonth(state, delta), { year, month, selectedDay: null }));
for (const [year, month, days, weekday] of [[2028, 1, 29, 2], [2026, 1, 28, 0], [2026, 3, 30, 3], [2026, 0, 31, 4], [2100, 1, 28, 1], [2000, 1, 29, 2]]) {
    test(`month grid ${year}-${month + 1}: ${days} days and correct starting weekday`, () => {
        const result = appointmentMonth([], { year, month });
        assert.equal(result.days.length, days); assert.equal(result.firstWeekday, weekday);
        assert.equal(result.days.at(-1).day, days);
    });
}
test('all seven possible weekday offsets are represented correctly', () => {
    const weekdays = new Set();
    for (let month = 0; month < 12; month++) weekdays.add(appointmentMonth([], { year: 2026, month }).firstWeekday);
    assert.equal(weekdays.size, 7);
});
test('date-only strings retain local year month and day', () => {
    const date = appointmentRecordDate(booking());
    assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()], [2026, 10, 10, 0]);
});
test('month boundaries never leak neighbouring records', () => {
    const result = appointmentMonth(['2026-10-31', '2026-11-01', '2026-11-30', '2026-12-01'].map(date => booking({ date })), november);
    assert.equal(result.days[0].records.length, 1); assert.equal(result.days[29].records.length, 1);
    assert.equal(result.days.flatMap(day => day.records).length, 2);
});
test('multiple bookings on the same date are counted independently', () => {
    assert.equal(appointmentMonth([booking(), booking({ id: 'two' })], november).days[9].records.length, 2);
});
for (const timezone of ['America/Los_Angeles', 'Pacific/Auckland', 'Africa/Johannesburg']) {
    test(`no UTC shift in ${timezone}`, () => {
        const url = new URL('../js/features/appointmentCalendar.js', import.meta.url).href;
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {appointmentRecordDate,appointmentDateKey} from ${JSON.stringify(url)}; console.log(appointmentDateKey(appointmentRecordDate({date:'2026-11-01'})));`], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), '2026-11-01');
    });
}
for (const [status, visible] of [['pending', true], ['cancelled', true], ['canceled', true], ['completed', false], ['COMPLETED', false], [undefined, true]]) {
    test(`month and day share ${String(status)} visibility`, () => {
        const records = [booking({ status })];
        assert.equal(monthRecords(records).length, Number(visible)); assert.equal(dayRecords(records).length, Number(visible));
    });
}
for (const [time, label] of [['08:00', '08:00'], ['8:15', '08:00'], ['17:59', '17:00'], ['07:59', 'Other'], ['18:00', 'Other'], ['08:99', 'Other'], ['08:00junk', 'Other'], ['24:00', 'Other'], ['', 'Other'], [undefined, 'Other']]) {
    test(`time ${String(time)} belongs to ${label}`, () => {
        const slots = appointmentDaySlots([booking({ time })], '2026-11-10');
        assert.equal(slots.find(slot => slot.records.length)?.label, label);
        assert.equal(slots.flatMap(slot => slot.records).length, 1);
    });
}
test('sparse records without IDs are not lost from Other', () => {
    const records = [booking({ id: undefined }), booking({ id: undefined, time: null })];
    assert.equal(dayRecords(records).length, 2);
});
for (const date of ['2026-02-30', '2026-13-01', '2026-2-30', '2026-11-31T10:00:00Z', 'invalid', {}, new Date(NaN)]) {
    test(`malformed date ${String(date)} fails safely`, () => assert.equal(monthRecords([booking({ date })]).length, 0));
}
test('null records and throwing legacy timestamp do not crash calendar', () => {
    assert.doesNotThrow(() => appointmentMonth([null, {}, { createdAt: { toDate() { throw Error('bad'); } } }], november));
});
test('missing legacy date uses timestamp fallback', () => {
    assert.equal(monthRecords([booking({ date: undefined, createdAt: { toDate: () => new Date(2026, 10, 10) } })]).length, 1);
});
test('contract year 0001 remains year 0001 rather than 1901', () => {
    assert.equal(appointmentDateKey(appointmentRecordDate({ date: '0001-01-01' })), '0001-01-01');
});
test('empty month includes every day and no stale counts', () => {
    assert.equal(appointmentMonth([], november).days.length, 30);
    assert.ok(appointmentMonth([], november).days.every(day => day.records.length === 0));
});

// Execute the actual page feature with only Firebase imports stubbed out. The
// small DOM surface records rendered markup/listeners; no persistence is allowed.
const featureURL = new URL('../js/features/appointments.js', import.meta.url);
let source = await readFile(featureURL, 'utf8');
source = source.replace(/import \{ firestore \}[^;]+;/, 'const firestore = {};');
source = source.replace(/import \{ collection,[^;]+;/, 'const collection = () => { throw Error("Unexpected Firestore access"); }; const deleteDoc = collection, doc = collection, getDocs = collection, query = collection, serverTimestamp = collection, setDoc = collection, where = collection;');
source = source.replace(/from '(\.[^']+)'/g, (_, relative) => `from '${new URL(relative, featureURL).href}'`);
const { initAppointmentsPage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
class Element {
    innerHTML = ''; textContent = ''; hidden = false; value = ''; dataset = {}; listeners = new Map(); disabled = false;
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    closest() { return null; }
    async fire(type, target = this) {
        const event = { target, stopped: false, stopPropagation() { this.stopped = true; } };
        for (const listener of this.listeners.get(type) || []) await listener(event);
        return event;
    }
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fixture = (initial = []) => {
    const elements = new Map();
    const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
    const shell = { querySelector: selector => el(selector.slice(1)) };
    let records = initial;
    const edits = []; const table = new Element(); const stats = Array.from({ length: 4 }, () => new Element());
    el('appointmentPeriodFilter').value = 'today';
    const feature = initAppointmentsPage({ pageName: 'appointments', pageShell: shell, tableBody: table, statCards: stats,
        pageEscape: escape, initials: () => 'A', statusClass: () => '', getRecords: () => records,
        getCurrentUser: () => ({ uid: 'owner' }), reloadRecords: async () => {}, showMessage: () => {},
        editRecord: async (user, id) => { edits.push({ user, id }); }
    });
    feature.refresh();
    return { el, feature, table, stats, edits, setRecords(value) { records = value; feature.refresh(); },
        async navigate(delta) { for (let i = 0; i < Math.abs(delta); i++) await el(delta > 0 ? 'appointmentsNextMonthButton' : 'appointmentsPrevMonthButton').fire('click'); },
        async day(key) {
            await el('appointmentsCalendarGrid').fire('click', {
                closest: selector => selector === '[data-appointments-retry]' ? null : ({ dataset: { date: key } })
            });
        }
    };
};
// Keep the test aligned with the browser's actual current day so the "today"
// range and the rendered record date match the page's runtime date logic.
const now = new Date();
const next = moveAppointmentMonth(createAppointmentCalendarState(now), 1);
const nextDate = `${next.year}-${String(next.month + 1).padStart(2, '0')}-10`;
const todayKey = appointmentDateKey(now);
const todayDisplay = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
test('table prioritizes date and time, keeps cancellation visible, and excludes completed appointments', () => {
    const f = fixture([
        booking({ id: 'pending-today', date: todayKey, time: '09:30', customerName: 'Pending Customer', service: 'Consulting' }),
        booking({ id: 'cancelled-today', date: todayKey, time: '10:30', customerName: 'Cancelled Customer', status: 'cancelled' }),
        booking({ id: 'completed-today', date: todayKey, time: '08:30', customerName: 'Completed Customer', status: 'completed' })
    ]);
    assert.match(f.table.innerHTML, new RegExp(`${todayDisplay} · 09:30`));
    assert.match(f.table.innerHTML, /Pending Customer/);
    assert.match(f.table.innerHTML, /Consulting/);
    assert.match(f.table.innerHTML, /cancelled/);
    assert.doesNotMatch(f.table.innerHTML, /Completed Customer/);
    assert.match(f.table.innerHTML, /data-record-id="pending-today"/);
    assert.deepEqual(f.stats.map(stat => stat.textContent), [3, 1, 1, 1]);
});
test('calendar day selection is exposed, preserves the date when returning to month, and labels its empty state', async () => {
    const f = fixture();
    await f.day(todayKey);
    assert.equal(f.el('appointmentsCalendarGrid').innerHTML.match(/data-date="[^"]+"[^>]*aria-pressed="true"/)?.[0].includes(`data-date="${todayKey}"`), true);
    assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, /No appointments scheduled for this day/);
    await f.el('appointmentsBackToMonthButton').fire('click');
    assert.equal(f.el('appointmentsCalendarDayView').hidden, true);
    assert.match(f.el('appointmentsCalendarGrid').innerHTML, new RegExp(`data-date="${todayKey}"[^>]*aria-pressed="true"`));
});
test('calendar day schedule shows pending and cancelled status and excludes completed records', async () => {
    const f = fixture([
        booking({ id: 'pending-calendar', date: todayKey, customerName: 'Current Customer', service: 'Consulting' }),
        booking({ id: 'cancelled-calendar', date: todayKey, time: '09:00', customerName: 'Cancelled Customer', status: 'cancelled' }),
        booking({ id: 'completed-calendar', date: todayKey, time: '10:00', customerName: 'Completed Customer', status: 'completed' })
    ]);
    await f.day(todayKey);
    assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, /Current Customer/);
    assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, /Consulting/);
    assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, />pending</);
    assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, />cancelled</);
    assert.doesNotMatch(f.el('appointmentsCalendarDaySlots').innerHTML, /Completed Customer/);
    assert.ok(f.el('appointmentsCalendarDaySlots').innerHTML.indexOf('Current Customer') < f.el('appointmentsCalendarDaySlots').innerHTML.indexOf('Cancelled Customer'));
});
test('appointment loading and failure remain distinct calendar states with retry', () => {
    const f = fixture();
    f.feature.setLoading();
    assert.match(f.table.innerHTML, /Loading appointments/);
    assert.match(f.el('appointmentsCalendarGrid').innerHTML, /role="status"/);
    f.feature.setError('The schedule could not be loaded.');
    assert.match(f.el('appointmentsCalendarGrid').innerHTML, /role="alert"/);
    assert.match(f.el('appointmentsCalendarGrid').innerHTML, /data-appointments-retry/);
});
for (const period of ['today', 'week', 'month']) {
    test(`${period} table filter does not constrain selected calendar month`, async () => {
        const f = fixture([booking({ date: nextDate })]); await f.navigate(1);
        f.el('appointmentPeriodFilter').value = period; await f.el('appointmentPeriodFilter').fire('change');
        assert.match(f.el('appointmentsCalendarGrid').innerHTML, /1 appointment/);
        assert.doesNotMatch(f.table.innerHTML, /Alex/);
        assert.match(f.el('appointmentsCalendarGrid').innerHTML, new RegExp(nextDate));
    });
}
test('Table Calendar Table Calendar preserves month and selected day', async () => {
    const f = fixture([booking({ date: nextDate })]); await f.navigate(1); await f.day(nextDate);
    const label = f.el('appointmentsCalendarMonthLabel').textContent;
    for (let i = 0; i < 3; i++) await f.el('appointmentsCalendarViewButton').fire('click');
    assert.equal(f.el('appointmentsCalendarMonthLabel').textContent, label);
    assert.equal(f.el('appointmentsCalendarDayView').hidden, false);
    assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, /Alex/);
});
test('Back returns to the selected month', async () => {
    const f = fixture(); await f.navigate(1); const label = f.el('appointmentsCalendarMonthLabel').textContent;
    await f.day(nextDate); await f.el('appointmentsBackToMonthButton').fire('click');
    assert.equal(f.el('appointmentsCalendarMonthLabel').textContent, label);
    assert.equal(f.el('appointmentsCalendarGrid').hidden, false); assert.equal(f.el('appointmentsCalendarDayView').hidden, true);
});
test('native event button selects correct booking through injected existing Edit flow and stops bubbling', async () => {
    const f = fixture([booking({ date: nextDate }), booking({ id: 'two', date: nextDate })]); await f.navigate(1); await f.day(nextDate);
    assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, /<button type="button"[^>]+data-calendar-edit="two"[^>]+aria-label="Edit appointment:/);
    const button = { dataset: { calendarEdit: 'two' }, disabled: false };
    const event = await f.el('appointmentsCalendarDaySlots').fire('click', {
        closest: selector => selector === '[data-appointments-retry]' ? null : button
    });
    assert.deepEqual(f.edits, [{ user: { uid: 'owner' }, id: 'two' }]); assert.equal(event.stopped, true); assert.equal(button.disabled, false);
});
test('stale or foreign event cannot open an edit', async () => {
    const f = fixture([booking({ ownerId: 'other' })]);
    for (const id of ['one', 'missing']) await f.el('appointmentsCalendarDaySlots').fire('click', { closest: () => ({ dataset: { calendarEdit: id } }) });
    assert.equal(f.edits.length, 0);
});
test('calendar callback is wired to the same savePageRecord used by table edit', async () => {
    const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
    assert.match(script, /editRecord: \(user, recordId\) => savePageRecord\(user, recordId\)/);
    assert.match(script, /button.dataset.pageAction === 'edit'\) await savePageRecord\(getCurrentUser\(\), recordId\)/);
});
for (const action of ['create', 'edit', 'complete', 'cancel', 'delete']) {
    test(`${action} refresh updates month/day without resetting navigation`, async () => {
        const existing = booking({ date: nextDate }); const f = fixture(action === 'create' ? [] : [existing]);
        await f.navigate(1); await f.day(nextDate); const label = f.el('appointmentsCalendarMonthLabel').textContent;
        const replacements = { create: [existing], edit: [{ ...existing, date: nextDate.replace(/10$/, '11') }], complete: [{ ...existing, status: 'completed' }], cancel: [{ ...existing, status: 'cancelled' }], delete: [] };
        f.setRecords(replacements[action]);
        assert.equal(f.el('appointmentsCalendarMonthLabel').textContent, label);
        assert.equal(f.el('appointmentsCalendarDayView').hidden, false);
        const visibleDay = ['create', 'cancel'].includes(action);
        assert.equal(f.el('appointmentsCalendarDaySlots').innerHTML.includes('Alex'), visibleDay);
        assert.equal(f.el('appointmentsCalendarGrid').innerHTML.includes('1 appointment'), !['complete', 'delete'].includes(action));
        if (action === 'cancel') {
            assert.match(f.el('appointmentsCalendarGrid').innerHTML, /1 appointment, 1 cancelled/);
            assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, />cancelled</);
        }
        if (action === 'edit') { await f.day(nextDate.replace(/10$/, '11')); assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, /Alex/); }
    });
}
test('calendar markup escapes record IDs and customer text', async () => {
    const f = fixture([booking({ date: nextDate, id: '"<unsafe>', customerName: '<img onerror=bad>' })]); await f.day(nextDate);
    assert.doesNotMatch(f.el('appointmentsCalendarDaySlots').innerHTML, /<img/);
    assert.match(f.el('appointmentsCalendarDaySlots').innerHTML, /&quot;&lt;unsafe&gt;/);
});
