import { injectable } from 'tsyringe';
import { ILogger } from '../agents/interfaces';

@injectable()
export class Logger implements ILogger {
  info(message: string): void {
    console.log(`[INFO] ${new Date().toISOString()}: ${message}`);
  }
  error(message: string, err?: any): void {
    console.error(`[ERROR] ${new Date().toISOString()}: ${message}`, err || '');
  }
  warn(message: string): void {
    console.warn(`[WARN] ${new Date().toISOString()}: ${message}`);
  }
}
