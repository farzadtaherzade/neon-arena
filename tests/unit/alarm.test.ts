import { describe, expect, it } from 'vitest';
import { TowerAlarm } from '../../src/game/alarm';
import { ALARM } from '../../src/game/config';

const dt = 1 / 60;

describe('TowerAlarm', () => {
  it('lights a tower while it sees hostiles', () => {
    const a = new TowerAlarm(4);
    a.update(dt, [true, false, false, false]);
    expect(a.hot).toEqual([true, false, false, false]);
  });

  it('reports the rising edge once, not every frame', () => {
    const a = new TowerAlarm(2);
    expect(a.update(dt, [true, false])).toBe(true);
    let extra = 0;
    for (let i = 0; i < 60; i++) if (a.update(dt, [true, false])) extra++;
    expect(extra).toBe(0);
  });

  it('holds the alarm briefly after contact drops', () => {
    const a = new TowerAlarm(1);
    a.update(dt, [true]);
    // Hostile steps behind cover for half a second: the alarm must not strobe.
    for (let i = 0; i < Math.round(0.5 / dt); i++) a.update(dt, [false]);
    expect(a.hot[0]).toBe(true);

    for (let i = 0; i < Math.round((ALARM.HOLD + 0.5) / dt); i++) a.update(dt, [false]);
    expect(a.hot[0]).toBe(false);
  });

  it('fires again after a full decay', () => {
    const a = new TowerAlarm(1);
    a.update(dt, [true]);
    for (let i = 0; i < Math.round((ALARM.HOLD + 0.2) / dt); i++) a.update(dt, [false]);
    expect(a.hot[0]).toBe(false);
    expect(a.update(dt, [true])).toBe(true);
  });

  it('tracks towers independently', () => {
    const a = new TowerAlarm(3);
    a.update(dt, [false, true, false]);
    expect(a.hot).toEqual([false, true, false]);
    a.update(dt, [false, true, true]);
    expect(a.hot).toEqual([false, true, true]);
  });

  it('resets to cold', () => {
    const a = new TowerAlarm(2);
    a.update(dt, [true, true]);
    a.reset();
    expect(a.hot).toEqual([false, false]);
    // After a reset the next contact is an edge again.
    expect(a.update(dt, [true, false])).toBe(true);
  });
});
