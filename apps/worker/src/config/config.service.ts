import { WorkerConfig } from '@cloudtask/contracts';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  constructor(private readonly config: WorkerConfig) {}

  get<K extends keyof WorkerConfig>(key: K): WorkerConfig[K] {
    return this.config[key];
  }

  get values(): Readonly<WorkerConfig> {
    return this.config;
  }
}
