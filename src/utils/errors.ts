export class ScanFailedError extends Error {
  readonly imageName: string;
  readonly imageTag: string;

  constructor(imageName: string, imageTag: string, cause?: unknown) {
    const message = `Scan failed for ${imageName}:${imageTag}`;
    super(message);
    this.name = 'ScanFailedError';
    this.imageName = imageName;
    this.imageTag = imageTag;
    if (cause instanceof Error) {
      this.cause = cause;
      // Preserve original stack for traceability
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class ImageNotFoundError extends Error {
  readonly imageName: string;
  readonly imageTag: string;

  constructor(imageName: string, imageTag: string) {
    super(`Image not found: ${imageName}:${imageTag}`);
    this.name = 'ImageNotFoundError';
    this.imageName = imageName;
    this.imageTag = imageTag;
  }
}

export class ValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}
