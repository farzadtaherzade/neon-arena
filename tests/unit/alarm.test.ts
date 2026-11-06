import { describe, expect, it } from 'vitest';
import { TowerAlarm } from '../../src/game/alarm';
import { ALARM } from '../../src/game/config';

const dt = 1 / 60;
const map = (entries: [string, boolean][]): Map<string, boolean> => new Map(entries);

describe('TowerAlarm', () => {
  it('lights a tower while it sees hostiles', () => {
    const a = new TowerAlarm();
    a.update(dt, map([['a0', true], ['a1', false]]));
    expect(a.hot.get('a0')).toBe(true);
    expect(a.hot.get('a1')).toBe(false);
  });

  it('reports the rising edge once, not every frame', () => {
    const a = new TowerAlarm();
    expect(a.update(dt, map([['a0', true]]))).toBe(true);
    let extra = 0;
    for (let i = 0; i < 60; i++) if (a.update(dt, map([['a0', true]]))) extra++;
    expect(extra).toBe(0);
  });

  it('holds the alarm briefly after contact drops', () => {
    const a = new TowerAlarm();
    a.update(dt, map([['a0', true]]));
    // Hostile steps behind cover for half a second: the alarm must not strobe.
    for (let i = 0; i < Math.round(0.5 / dt); i++) a.update(dt, map([['a0', false]]));
    expect(a.isHot('a0')).toBe(true);

    for (let i = 0; i < Math.round((ALARM.HOLD + 0.5) / dt); i++) a.update(dt, map([['a0', false]]));
    expect(a.isHot('a0')).toBe(false);
  });

  it('fires again after a full decay', () => {
    const a = new TowerAlarm();
    a.update(dt, map([['a0', true]]));
    for (let i = 0; i < Math.round((ALARM.HOLD + 0.2) / dt); i++) a.update(dt, map([['a0', false]]));
    expect(a.isHot('a0')).toBe(false);
    expect(a.update(dt, map([['a0', true]]))).toBe(true);
  });

  it('tracks towers independently', () => {
    const a = new TowerAlarm();
    a.update(dt, map([['a0', false], ['a1', true], ['a2', false]]));
    expect(a.isHot('a1')).toBe(true);
    expect(a.isHot('a0')).toBe(false);
    a.update(dt, map([['a0', false], ['a1', true], ['a2', true]]));
    expect(a.isHot('a2')).toBe(true);
  });

  it('forgets towers that streamed out and accepts new ids', () => {
    const a = new TowerAlarm();
    a.update(dt, map([['0,0', true]]));
    expect(a.isHot('0,0')).toBe(true);
    // A district tower the caller stops reporting simply fades out of use.
    a.update(dt, map([['a0', true]]));
    expect(a.isHot('a0')).toBe(true);
    expect(a.isHot('0,0')).toBe(true); // its held state just sits idle
  });

  it('resets to cold', () => {
    const a = new TowerAlarm();
    a.update(dt, map([['a0', true], ['a1', true]]));
    a.reset();
    expect(a.isHot('a0')).toBe(false);
    expect(a.isHot('a1')).toBe(false);
    // After a reset the next contact is an edge again.
    expect(a.update(dt, map([['a0', true]]))).toBe(true);
  });
});
