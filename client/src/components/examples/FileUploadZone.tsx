import FileUploadZone from '../FileUploadZone';

export default function FileUploadZoneExample() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <FileUploadZone 
        onFileSelect={(files) => console.log('Files selected:', files)} 
        accept=".pdf,.jpg,.png"
      />
    </div>
  );
}
