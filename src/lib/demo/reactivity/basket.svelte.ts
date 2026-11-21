import type { Product } from '#lib/demo/catalog.js';

interface Line {
	product: Product;
	quantity: number;
}

/**
 * An ordinary class. The runes on its fields make it reactive: anything that reads `lines`,
 * `count` or `total`, in any component, updates when they change.
 */
class Basket {
	lines = $state<Line[]>([]);
	count = $derived(this.lines.reduce((sum, line) => sum + line.quantity, 0));
	total = $derived(this.lines.reduce((sum, line) => sum + line.quantity * line.product.price, 0));

	quantityOf(product: Product) {
		return this.lines.find((line) => line.product.id === product.id)?.quantity ?? 0;
	}

	add(product: Product) {
		const line = this.lines.find((line) => line.product.id === product.id);
		if (line) line.quantity += 1;
		else this.lines.push({ product, quantity: 1 });
	}

	remove(product: Product) {
		const index = this.lines.findIndex((line) => line.product.id === product.id);
		if (index === -1) return;
		this.lines[index].quantity -= 1;
		if (this.lines[index].quantity === 0) this.lines.splice(index, 1);
	}

	clear() {
		this.lines = [];
	}
}

/** One basket, shared by every component that imports it. */
export const basket = new Basket();
