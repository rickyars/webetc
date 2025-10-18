/**
 * UI Logger for displaying debug information
 */

export type LogLevel = 'info' | 'success' | 'error' | 'warn';

export class Logger {
  private logContainer: HTMLElement | null = null;
  private progressContainer: HTMLElement | null = null;
  private logs: Array<{ message: string; level: LogLevel }> = [];
  private progressBars: Map<string, number> = new Map();

  constructor(containerId: string = 'log', progressContainerId: string = 'progress-container') {
    this.logContainer = document.getElementById(containerId);
    this.progressContainer = document.getElementById(progressContainerId);
  }

  private formatMessage(message: string, level: LogLevel): string {
    const timestamp = new Date().toLocaleTimeString();
    const levelIcon = {
      info: 'ℹ️',
      success: '✓',
      error: '✗',
      warn: '⚠️',
    }[level];
    return `[${timestamp}] ${levelIcon} ${message}`;
  }

  log(message: string, level: LogLevel = 'info'): void {
    const formatted = this.formatMessage(message, level);
    this.logs.push({ message: formatted, level });
    console.log(`[${level}]`, message);
    this.render();
  }

  info(message: string): void {
    this.log(message, 'info');
  }

  success(message: string): void {
    this.log(message, 'success');
  }

  error(message: string): void {
    this.log(message, 'error');
  }

  warn(message: string): void {
    this.log(message, 'warn');
  }

  /**
   * Set progress for a named progress bar
   * @param name - Unique name for this progress bar (e.g., "cache", "dag")
   * @param progress - Progress percentage (0-100)
   */
  setProgress(name: string, progress: number): void {
    progress = Math.min(100, Math.max(0, progress));
    this.progressBars.set(name, progress);
    this.render();
  }

  /**
   * Clear a specific progress bar
   * @param name - Name of the progress bar to clear
   */
  clearProgress(name?: string): void {
    if (name) {
      this.progressBars.delete(name);
    } else {
      this.progressBars.clear();
    }
    this.render();
  }

  clear(): void {
    this.logs = [];
    this.progressBars.clear();
    this.render();
  }

  private render(): void {
    if (!this.logContainer) return;

    // Render progress bars in separate container
    if (this.progressContainer) {
      let progressHtml = '';
      for (const [name, progress] of this.progressBars) {
        const progressBarWidth = progress;
        progressHtml += `
          <div class="progress-item">
            <div class="progress-label">${name}: ${Math.round(progress)}%</div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${progressBarWidth}%"></div>
            </div>
          </div>
        `;
      }
      this.progressContainer.innerHTML = progressHtml;
    }

    // Add log entries
    let logHtml = this.logs
      .map(log => {
        let className = 'log-entry log-' + log.level;
        return `<div class="${className}">${log.message}</div>`;
      })
      .join('');

    this.logContainer.innerHTML = logHtml;

    // Auto-scroll to bottom
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }
}

export const globalLogger = new Logger();
