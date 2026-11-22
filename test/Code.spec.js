import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Code from '../src/Code.js';

// All fixtures are dummy data: fake calendar ids, generic titles and a
// made-up exclude word. Never copy real calendar content into tests.

let props;
let calendars;

function makeEvent({ title = 'Event', start, end, allDay = false, status = 'YES' }) {
  return {
    getTitle: () => title,
    getStartTime: () => new Date(start),
    getEndTime: () => new Date(end),
    isAllDayEvent: () => allDay,
    getMyStatus: () => status,
  };
}

global.ContentService = {
  createTextOutput: vi.fn((text) => ({ text, setMimeType: vi.fn() })),
  MimeType: { JSON: 'application/json' },
};

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => props[key] ?? null,
    setProperty: (key, value) => { props[key] = value; },
  }),
};

global.Utilities = {
  formatDate: vi.fn(() => '2026-11-24'),
  getUuid: vi.fn(() => 'dummy-uuid-'),
};

global.CalendarApp = {
  GuestStatus: { NO: 'NO', YES: 'YES' },
  getCalendarById: vi.fn((id) => calendars[id] ?? null),
};

function callGet(params) {
  Code.doGet({ parameter: params });
  const calls = global.ContentService.createTextOutput.mock.calls;
  return JSON.parse(calls[calls.length - 1][0]);
}

const DAY = '2026-11-24';
const at = (hhmm) => `${DAY}T${hhmm}:00+09:00`;

beforeEach(() => {
  props = {
    API_TOKEN: 'test-token',
    MAIN_CALENDAR_ID: 'dummy-main@example.com',
    FAMILY_CALENDAR_ID: 'dummy-family@example.com',
    EXCLUDE_WORDS: 'NGWORD',
  };
  calendars = {
    'dummy-main@example.com': { getEvents: () => [] },
    'dummy-family@example.com': { getEvents: () => [] },
  };
  vi.clearAllMocks();
});

describe('doGet authorization and config', () => {
  it('rejects a missing or wrong token', () => {
    expect(callGet({}).ok).toBe(false);
    expect(callGet({ token: 'wrong' }).ok).toBe(false);
  });

  it('rejects an invalid date', () => {
    expect(callGet({ token: 'test-token', date: '24/11/2026' }).error).toBe('Invalid date.');
  });

  it('reports not configured when calendar ids are unset', () => {
    delete props.MAIN_CALENDAR_ID;
    expect(callGet({ token: 'test-token', date: DAY }).error).toBe('Not configured.');
  });
});

describe('evening summary', () => {
  it('returns no plans for an empty day', () => {
    const res = callGet({ token: 'test-token', date: DAY });
    expect(res).toEqual({
      ok: true, date: DAY,
      hasNightPlan: false, nightPlanEnd: null, lastWorkEventEnd: null,
    });
  });

  it('detects an evening plan on the main calendar', () => {
    calendars['dummy-main@example.com'] = {
      getEvents: () => [makeEvent({ title: 'Dinner', start: at('19:00'), end: at('21:30') })],
    };
    const res = callGet({ token: 'test-token', date: DAY });
    expect(res.hasNightPlan).toBe(true);
    expect(res.nightPlanEnd).toBe(new Date(at('21:30')).toISOString());
  });

  it('uses the latest end when several evening plans exist', () => {
    calendars['dummy-main@example.com'] = {
      getEvents: () => [
        makeEvent({ title: 'A', start: at('18:00'), end: at('19:00') }),
        makeEvent({ title: 'B', start: at('20:00'), end: at('22:00') }),
      ],
    };
    const res = callGet({ token: 'test-token', date: DAY });
    expect(res.nightPlanEnd).toBe(new Date(at('22:00')).toISOString());
  });

  it('ignores family events whose title contains an exclude word', () => {
    calendars['dummy-family@example.com'] = {
      getEvents: () => [makeEvent({ title: 'NGWORD event', start: at('19:00'), end: at('20:00') })],
    };
    const res = callGet({ token: 'test-token', date: DAY });
    expect(res.hasNightPlan).toBe(false);
  });

  it('counts family events without an exclude word', () => {
    calendars['dummy-family@example.com'] = {
      getEvents: () => [makeEvent({ title: 'Family dinner', start: at('19:00'), end: at('20:00') })],
    };
    const res = callGet({ token: 'test-token', date: DAY });
    expect(res.hasNightPlan).toBe(true);
  });

  it('ignores all-day and declined events', () => {
    calendars['dummy-main@example.com'] = {
      getEvents: () => [
        makeEvent({ title: 'Holiday', start: at('00:00'), end: at('23:59'), allDay: true }),
        makeEvent({ title: 'Declined', start: at('19:00'), end: at('20:00'), status: 'NO' }),
      ],
    };
    const res = callGet({ token: 'test-token', date: DAY });
    expect(res.hasNightPlan).toBe(false);
    expect(res.lastWorkEventEnd).toBe(null);
  });

  it('treats a late-running daytime meeting as work, not a night plan', () => {
    calendars['dummy-main@example.com'] = {
      getEvents: () => [makeEvent({ title: 'Meeting', start: at('16:00'), end: at('18:30') })],
    };
    const res = callGet({ token: 'test-token', date: DAY });
    expect(res.hasNightPlan).toBe(false);
    expect(res.lastWorkEventEnd).toBe(new Date(at('18:30')).toISOString());
  });

  it('respects a custom evening start hour', () => {
    props.EVENING_START_HOUR = '18';
    calendars['dummy-main@example.com'] = {
      getEvents: () => [makeEvent({ title: 'Early dinner', start: at('17:30'), end: at('19:00') })],
    };
    const res = callGet({ token: 'test-token', date: DAY });
    expect(res.hasNightPlan).toBe(false);
    expect(res.lastWorkEventEnd).toBe(new Date(at('19:00')).toISOString());
  });
});
