import { calculateConcurrency } from '@/bullmq/tasks/scanners/trivy/worker.js';

describe('calculateConcurrency', () => {
  it('uses half of available parallelism', () => {
    expect(calculateConcurrency(10, 8)).toBe(4); // floor(8/2) = 4, min(10,4) = 4
    expect(calculateConcurrency(10, 4)).toBe(2); // floor(4/2) = 2, min(10,2) = 2
    expect(calculateConcurrency(10, 6)).toBe(3); // floor(6/2) = 3, min(10,3) = 3
  });

  it('is at least 1 regardless of available parallelism', () => {
    expect(calculateConcurrency(10, 1)).toBe(1); // floor(1/2)=0, max(1,0)=1
    expect(calculateConcurrency(10, 0)).toBe(1); // floor(0/2)=0, max(1,0)=1
  });

  it('caps at image count when parallelism is very high', () => {
    expect(calculateConcurrency(2, 100)).toBe(2);  // min(2, 50) = 2
    expect(calculateConcurrency(10, 200)).toBe(10); // min(10, 100) = 10
  });

  it('matches the formula from the plan exactly', () => {
    // Math.min(IMAGES.length, Math.max(1, Math.floor(os.availableParallelism() / 2)))
    const imageCount = 10;
    const parallelism = 4;
    const expected = Math.min(imageCount, Math.max(1, Math.floor(parallelism / 2)));
    expect(calculateConcurrency(imageCount, parallelism)).toBe(expected);
  });
});
