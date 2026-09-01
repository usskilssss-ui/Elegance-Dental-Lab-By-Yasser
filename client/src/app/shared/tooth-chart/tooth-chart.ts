import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  LOWER_LEFT,
  LOWER_RIGHT,
  ToothAssignment,
  ToothFdi,
  UPPER_LEFT,
  UPPER_RIGHT,
  areAdjacent,
  colorForMaterial,
  newGroupId,
} from './tooth-chart.types';

@Component({
  selector: 'app-tooth-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tooth-chart.html',
  styleUrl: './tooth-chart.css',
})
export class ToothChartComponent {
  @Input() assignments: ToothAssignment[] = [];
  /** Material currently being painted (from selected work-type chips). */
  @Input() activeMaterial = '';
  /** Available materials to show in legend (selected work types). */
  @Input() materials: string[] = [];
  /**
   * connected = new tooth joins adjacent same-material group (bridge)
   * separate = each tooth is its own unit
   */
  @Input() linkMode: 'connected' | 'separate' = 'separate';

  @Output() assignmentsChange = new EventEmitter<ToothAssignment[]>();
  @Output() activeMaterialChange = new EventEmitter<string>();
  @Output() linkModeChange = new EventEmitter<'connected' | 'separate'>();

  readonly upperRight = UPPER_RIGHT;
  readonly upperLeft = UPPER_LEFT;
  readonly lowerRight = LOWER_RIGHT;
  readonly lowerLeft = LOWER_LEFT;

  colorFor = colorForMaterial;

  assignmentMap(): Map<string, ToothAssignment> {
    const m = new Map<string, ToothAssignment>();
    for (const a of this.assignments || []) m.set(a.fdi, a);
    return m;
  }

  getFor(fdi: ToothFdi): ToothAssignment | undefined {
    return this.assignmentMap().get(fdi);
  }

  setActiveMaterial(mat: string): void {
    this.activeMaterialChange.emit(mat);
  }

  setLinkMode(mode: 'connected' | 'separate'): void {
    this.linkModeChange.emit(mode);
  }

  onToothClick(fdi: ToothFdi): void {
    if (!this.activeMaterial) return;
    const current = this.getFor(fdi);
    let next = [...(this.assignments || [])];

    // Toggle off if same material
    if (current && current.material === this.activeMaterial) {
      next = next.filter((a) => a.fdi !== fdi);
      this.assignmentsChange.emit(next);
      return;
    }

    // Remove old assignment for this tooth
    next = next.filter((a) => a.fdi !== fdi);

    let groupId = newGroupId();
    if (this.linkMode === 'connected') {
      // Neighbors of same material (may belong to different groups, e.g. 14 then 16 then 15)
      const neighbors = next.filter(
        (a) => a.material === this.activeMaterial && areAdjacent(a.fdi, fdi)
      );
      if (neighbors.length) {
        groupId = neighbors[0].groupId;
        const mergeIds = new Set(neighbors.map((n) => n.groupId));
        // Unify only the groups this new tooth touches — not every crown on the arch
        next = next.map((a) =>
          a.material === this.activeMaterial && mergeIds.has(a.groupId)
            ? { ...a, groupId }
            : a
        );
      }
    }

    next.push({ fdi, material: this.activeMaterial, groupId });
    this.assignmentsChange.emit(next);
  }

  clearAll(): void {
    this.assignmentsChange.emit([]);
  }

  /** True if this tooth and the next in row share a bridge group. */
  bridgedWithNext(fdi: ToothFdi, next: ToothFdi | undefined): boolean {
    if (!next) return false;
    const a = this.getFor(fdi);
    const b = this.getFor(next);
    return !!(a && b && a.groupId === b.groupId && a.material === b.material);
  }

  legendItems(): { material: string; color: string; count: number }[] {
    const counts: Record<string, number> = {};
    for (const a of this.assignments || []) {
      counts[a.material] = (counts[a.material] || 0) + 1;
    }
    const mats = this.materials.length
      ? this.materials
      : Object.keys(counts);
    return mats.map((material) => ({
      material,
      color: colorForMaterial(material),
      count: counts[material] || 0,
    }));
  }

  summaryText(): string {
    const parts: string[] = [];
    const byGroup = new Map<string, ToothAssignment[]>();
    for (const a of this.assignments || []) {
      const list = byGroup.get(a.groupId) || [];
      list.push(a);
      byGroup.set(a.groupId, list);
    }
    for (const [, teeth] of byGroup) {
      const mat = teeth[0].material;
      const nums = teeth.map((t) => t.fdi).sort().join('-');
      if (teeth.length > 1) parts.push(`${mat} جسر [${nums}]`);
      else parts.push(`${mat} ${nums}`);
    }
    return parts.join(' · ');
  }
}
