import * as THREE from 'three';
import type { Deck } from '../game/capture';
import { CAPTURE } from '../game/config';
import { MAT } from './Materials';

/**
 * A gatehouse tower top: the capture pad on the deck, the mast that makes it
 * readable from across the maze, and the beacon that doubles as the alarm.
 *
 * The beacon is the map's wayfinding language — amber on the deck you can take
 * this wave, dim cyan on the other three, and red when hostiles mass nearby.
 *
 * Deliberately not additive for the pad: the deck top is an unlit cyan slab, and
 * stacking additive cyan on it blew the view out to white. The beacon column is
 * thin enough that the camera can never be inside it.
 *
 * Static for the session, like the arena's walls — built once, never rebuilt.
 */

/** The platform's deck skin is a 0.08 slab on the collider top — float above it. */
const DECK_SKIN = 0.1;
const AMBER = 0xf2b21e;
const CYAN = 0x46e0ff;
const ALARM_RED = 0xff3b30;
const DARK = 0x05070c;

export class CapturePad {
  /** The mast, so the arena can register it as a collider and a bullet blocker. */
  readonly mast: THREE.Mesh;

  private readonly group = new THREE.Group();
  private readonly padGroup = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly beacon: THREE.Mesh;
  private readonly column: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly columnMat: THREE.MeshBasicMaterial;

  constructor(readonly deck: Deck) {
    // --- pad ---------------------------------------------------------------
    // Dark base so the pad is a circle rather than a glow on a glowing deck.
    const base = new THREE.Mesh(
      new THREE.CircleGeometry(CAPTURE.RADIUS, 40),
      new THREE.MeshBasicMaterial({
        color: DARK,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.02;
    base.renderOrder = 1;

    this.fillMat = new THREE.MeshBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(CAPTURE.RADIUS - 0.16, 40), this.fillMat);
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.position.y = 0.03;
    this.fill.renderOrder = 2;
    this.fill.scale.setScalar(0.001);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CAPTURE.RADIUS - 0.12, CAPTURE.RADIUS, 48),
      this.ringMat,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.renderOrder = 3;
    this.padGroup.add(base, this.fill, ring);

    // --- mast and beacon ---------------------------------------------------
    this.mast = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x2e394e, roughness: 0.55, metalness: 0.4 }),
    );
    this.mast.position.y = 2.5;
    this.mast.castShadow = true;

    // Hazard collar near the top: without it the dark mast vanishes against the
    // sky and the beacon reads as a light floating in mid-air.
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.55, 0.58), MAT.hazard());
    collar.position.y = 4.4;
    this.mast.add(collar);

    this.beaconMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35 });
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), this.beaconMat);
    this.beacon.position.y = 5.2;

    this.columnMat = new THREE.MeshBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4, 10, 1, true), this.columnMat);
    this.column.position.y = 7.4;
    this.column.visible = false;

    this.group.add(this.padGroup, this.mast, this.beacon, this.column);
    this.group.position.set(deck.x, deck.y + DECK_SKIN, deck.z);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
  }

  /**
   * `active`: this is the live deck. `ready`: not on cooldown.
   * `alarm`: hostiles are massing inside this tower's alarm radius.
   */
  sync(active: boolean, ready: boolean, progress: number, elapsed: number, alarm: boolean): void {
    this.padGroup.visible = active;

    // Beacon: red beats everything, then the live deck, then a dim standby.
    const fast = 0.5 + 0.5 * Math.sin(elapsed * 12);
    const slow = 0.5 + 0.5 * Math.sin(elapsed * 3);
    if (alarm) {
      this.beaconMat.color.setHex(ALARM_RED);
      this.beaconMat.opacity = 0.55 + fast * 0.45;
    } else if (active && ready) {
      this.beaconMat.color.setHex(AMBER);
      this.beaconMat.opacity = 0.7 + slow * 0.3;
    } else {
      this.beaconMat.color.setHex(CYAN);
      this.beaconMat.opacity = active ? 0.35 : 0.18;
    }
    this.column.visible = active || alarm;
    this.columnMat.color.setHex(alarm ? ALARM_RED : AMBER);
    this.columnMat.opacity = alarm ? 0.12 + fast * 0.1 : 0.1 + slow * 0.06;

    if (!active) return;

    this.ringMat.opacity = ready ? 0.7 + slow * 0.3 : 0.22;
    this.fillMat.opacity = ready ? 0.45 : 0.12;
    this.fill.scale.setScalar(progress > 0.001 ? progress : 0.001);
  }
}
