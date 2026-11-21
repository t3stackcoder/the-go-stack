/**
 * `count` different whole numbers from 0 up to (not including) `max`, chosen at random.
 *
 * The heatmap demo uses this to pick which cells to change. Picking distinct cells keeps the
 * readout honest: a cell picked twice in one frame would be changed twice but written once.
 */
export function distinct(count: number, max: number): number[] {
	if (!Number.isInteger(count) || count < 0 || count > max) {
		throw new RangeError(`Cannot pick ${count} distinct numbers below ${max}.`);
	}

	const picked = new Set<number>();
	while (picked.size < count) picked.add(Math.floor(Math.random() * max));
	return [...picked];
}
