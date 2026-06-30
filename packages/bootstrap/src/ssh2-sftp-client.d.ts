declare module 'ssh2-sftp-client' {
  export default class Client {
    connect(opts: { host: string; port: number; username: string; password: string }): Promise<void>;
    get(remotePath: string): Promise<Buffer>;
    put(input: Buffer, remotePath: string): Promise<string>;
    list(remotePath: string): Promise<Array<{ name: string; size: number; type: string; [key: string]: unknown }>>;
    delete(remotePath: string): Promise<string>;
    rename(from: string, to: string): Promise<string>;
    end(): Promise<void>;
  }
}
