export interface VirtualFile {
  content: string;
  isDirectory: boolean;
}

/**
 * Minimal read-mostly virtual file system for php_modules / require lookups.
 *
 * Keeps the browser shim dependency-free; paths are normalised to forward
 * slashes and compared case-sensitively (Unix style).
 */
export class VirtualFs {
  private files = new Map<string, VirtualFile>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.writeFile(path, content);
    }
  }

  writeFile(path: string, content: string): void {
    this.files.set(this.normalize(path), { content, isDirectory: false });
  }

  readFile(path: string): string | undefined {
    const file = this.files.get(this.normalize(path));
    return file && !file.isDirectory ? file.content : undefined;
  }

  exists(path: string): boolean {
    return this.files.has(this.normalize(path));
  }

  isDirectory(path: string): boolean {
    const file = this.files.get(this.normalize(path));
    return file ? file.isDirectory : false;
  }

  private normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/');
  }
}
