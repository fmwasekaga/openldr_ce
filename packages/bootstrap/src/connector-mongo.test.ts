import { describe, it, expect } from 'vitest';
import { buildMongoUri } from './connector-mongo';

describe('buildMongoUri', () => {
  it('assembles a uri with encoded credentials', () => {
    expect(buildMongoUri({ host: 'h', port: '27017', database: 'lab', user: 'u', password: 'p@ss' })).toBe('mongodb://u:p%40ss@h:27017/lab');
  });
  it('adds authSource when set and brackets IPv6', () => {
    expect(buildMongoUri({ host: '::1', port: '27017', database: 'd', user: 'u', password: 'p', authSource: 'admin' })).toBe('mongodb://u:p@[::1]:27017/d?authSource=admin');
  });
  it('omits credentials when user is blank', () => {
    expect(buildMongoUri({ host: 'h', port: '27017', database: 'd' })).toBe('mongodb://h:27017/d');
  });
});
