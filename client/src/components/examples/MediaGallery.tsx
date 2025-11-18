import MediaGallery from '../MediaGallery';

export default function MediaGalleryExample() {
  const items = [
    {
      id: '1',
      type: 'image' as const,
      url: '/placeholder1.jpg',
      caption: 'Foundation excavation complete',
      uploadedBy: 'Mike Johnson',
      uploadedAt: '2024-01-18',
    },
    {
      id: '2',
      type: 'image' as const,
      url: '/placeholder2.jpg',
      caption: 'Concrete pour in progress',
      uploadedBy: 'Mike Johnson',
      uploadedAt: '2024-01-17',
    },
    {
      id: '3',
      type: 'video' as const,
      url: '/placeholder3.mp4',
      caption: 'Time lapse - Day 5',
      uploadedBy: 'Tom Anderson',
      uploadedAt: '2024-01-16',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <MediaGallery 
        items={items} 
        onUpload={(files) => console.log('Files uploaded:', files)}
        onDelete={(id) => console.log('Delete media:', id)}
      />
    </div>
  );
}
