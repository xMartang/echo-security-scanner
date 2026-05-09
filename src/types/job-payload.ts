export type ScanImageJobData = {
  imageName: string;
  imageTag: string;
};

export type SchedulerTickJobData = {
  triggeredAt: string; // ISO timestamp
};

export type ScanImageJobResult = {
  cveCount: number;
};
