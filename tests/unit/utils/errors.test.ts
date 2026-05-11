import { ScanFailedError, ImageNotFoundError, ValidationError } from '@/common/utils/errors.js';

describe('ScanFailedError', () => {
  it('is instanceof Error and ScanFailedError', () => {
    const err = new ScanFailedError('nginx', '1.19');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ScanFailedError);
  });

  it('sets name, message, imageName, imageTag', () => {
    const err = new ScanFailedError('nginx', '1.19');
    expect(err.name).toBe('ScanFailedError');
    expect(err.message).toBe('Scan failed for nginx:1.19');
    expect(err.imageName).toBe('nginx');
    expect(err.imageTag).toBe('1.19');
  });

  it('preserves cause stack', () => {
    const cause = new Error('underlying error');
    const err = new ScanFailedError('nginx', '1.19', cause);
    expect(err.stack).toContain('Caused by:');
    expect(err.cause).toBe(cause);
  });

  it('has a stack trace', () => {
    const err = new ScanFailedError('nginx', '1.19');
    expect(err.stack).toContain('ScanFailedError');
  });
});

describe('ImageNotFoundError', () => {
  it('is instanceof Error and ImageNotFoundError', () => {
    const err = new ImageNotFoundError('alpine', '3.12');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ImageNotFoundError);
  });

  it('sets name and message', () => {
    const err = new ImageNotFoundError('alpine', '3.12');
    expect(err.name).toBe('ImageNotFoundError');
    expect(err.message).toBe('Image not found: alpine:3.12');
    expect(err.imageName).toBe('alpine');
    expect(err.imageTag).toBe('3.12');
  });
});

describe('ValidationError', () => {
  it('is instanceof Error and ValidationError', () => {
    const err = new ValidationError('invalid severity');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
  });

  it('sets name, message, and optional field', () => {
    const err = new ValidationError('invalid severity value', 'severity');
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('invalid severity value');
    expect(err.field).toBe('severity');
  });

  it('field is undefined when not provided', () => {
    const err = new ValidationError('bad input');
    expect(err.field).toBeUndefined();
  });
});
