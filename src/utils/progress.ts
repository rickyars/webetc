/**
 * Progress Monitoring Utility
 *
 * Provides progress bar visualization for long-running operations
 */

export interface ProgressCallback {
  (current: number, total: number, message?: string): void;
}

export class ProgressMonitor {
  private elementId: string;
  private current = 0;
  private total = 1;
  private message = '';

  constructor(elementId: string = 'progress-container') {
    this.elementId = elementId;
  }

  /**
   * Initialize progress bar
   * @param total Total items to process
   * @param message Initial message
   */
  public init(total: number, message: string = ''): void {
    this.total = Math.max(1, total);
    this.current = 0;
    this.message = message;
    this.render();
  }

  /**
   * Update progress
   * @param current Current item count
   * @param message Optional status message
   */
  public update(current: number, message?: string): void {
    this.current = Math.min(current, this.total);
    if (message) {
      this.message = message;
    }
    this.render();
  }

  /**
   * Increment progress
   * @param amount Amount to increment (default 1)
   * @param message Optional status message
   */
  public increment(amount: number = 1, message?: string): void {
    this.update(this.current + amount, message);
  }

  /**
   * Complete the progress
   * @param message Final message
   */
  public complete(message?: string): void {
    this.current = this.total;
    if (message) {
      this.message = message;
    }
    this.render();
  }

  /**
   * Get progress percentage
   */
  public getPercent(): number {
    return Math.round((this.current / this.total) * 100);
  }

  /**
   * Render progress bar
   */
  private render(): void {
    const container = document.getElementById(this.elementId);
    if (!container) {
      console.warn(`Progress container #${this.elementId} not found`);
      return;
    }

    const percent = this.getPercent();
    const progressHtml = `
      <div class="progress-item">
        <div class="progress-label">${this.message}</div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${percent}%">
            <div class="progress-text">${percent}%</div>
          </div>
        </div>
        <div class="progress-info">${this.current.toLocaleString()} / ${this.total.toLocaleString()}</div>
      </div>
    `;

    container.innerHTML = progressHtml;
  }

  /**
   * Clear the progress display
   */
  public clear(): void {
    const container = document.getElementById(this.elementId);
    if (container) {
      container.innerHTML = '';
    }
  }
}

/**
 * Create a callback function for progress monitoring
 * Useful for integration with async operations
 */
export function createProgressCallback(monitor: ProgressMonitor): ProgressCallback {
  return (current: number, total: number, message?: string) => {
    if (current === 0) {
      monitor.init(total, message || 'Processing...');
    } else {
      monitor.update(current, message);
    }
  };
}
