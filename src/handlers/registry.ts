export class HandlerRegistry<H extends { customId: string | RegExp }> {
  private exact = new Map<string, H>();
  private patterns: Array<{ re: RegExp; handler: H }> = [];

  add(handler: H): void {
    if (handler.customId instanceof RegExp) {
      this.patterns.push({ re: handler.customId, handler });
    } else {
      this.exact.set(handler.customId, handler);
    }
  }

  find(customId: string): H | undefined {
    return this.exact.get(customId) ?? this.patterns.find((p) => p.re.test(customId))?.handler;
  }

  get size(): number {
    return this.exact.size + this.patterns.length;
  }
}
