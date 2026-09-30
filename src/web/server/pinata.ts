export interface PinataPort {
  uploadFile(file: File, name: string): Promise<string>;
  uploadJson(data: object, name: string): Promise<string>;
}
