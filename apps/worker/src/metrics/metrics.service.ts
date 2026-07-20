import { Injectable } from '@nestjs/common';

interface MetricDef {
  Name: string;
  Unit: string;
}

/**
 * Emits CloudWatch Embedded Metric Format (EMF) lines to stdout (spec §10).
 * In AWS the log agent parses these into metrics in the CloudTask/Dev
 * namespace; locally they are just JSON log lines.
 */
@Injectable()
export class MetricsService {
  private static readonly NAMESPACE = 'CloudTask/Dev';

  exportCompleted(durationMs: number): void {
    this.emit(
      { ExportsCompleted: 1, ExportProcessingDurationMs: durationMs },
      [
        { Name: 'ExportsCompleted', Unit: 'Count' },
        { Name: 'ExportProcessingDurationMs', Unit: 'Milliseconds' },
      ],
    );
  }

  exportFailed(): void {
    this.emit({ ExportsFailed: 1 }, [{ Name: 'ExportsFailed', Unit: 'Count' }]);
  }

  private emit(values: Record<string, number>, metrics: MetricDef[]): void {
    const line = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          { Namespace: MetricsService.NAMESPACE, Dimensions: [[]], Metrics: metrics },
        ],
      },
      ...values,
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }
}
