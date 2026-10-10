import { useEffect, useRef, useState } from 'react';

export function useChatInputFiles({ conversationId, conversations }) {
  const [inputFiles, setInputFiles] = useState([]);
  const [filesUploading, setFilesUploading] = useState(false);
  const [fileUploadProgress, setFileUploadProgress] = useState(null);
  const inputFilesRef = useRef([]);
  const pendingUploadsRef = useRef(0);
  const generationRef = useRef(0);
  const uploadControllersRef = useRef(new Set());

  function abortUploads() {
    for (const controller of uploadControllersRef.current) controller.abort();
    uploadControllersRef.current.clear();
  }

  useEffect(() => () => abortUploads(), []);

  async function addInputFiles(files) {
    if (!files?.length) return;
    if (!conversations) throw new Error('DSH 聊天服务尚未就绪。');
    if (!conversationId) throw new Error('请先打开一个聊天。');
    const generation = generationRef.current;
    pendingUploadsRef.current += 1;
    setFilesUploading(true);
    try {
      for (const file of files) {
        if (generation !== generationRef.current) return;
        setFileUploadProgress({ name: file.name, percent: 0 });
        const controller = new AbortController();
        uploadControllersRef.current.add(controller);
        let staged;
        try {
          staged = await conversations.uploadFile(conversationId, file, {
            signal: controller.signal,
            onProgress: ({ loaded, total }) => {
              if (generation !== generationRef.current) return;
              const bytes = total ?? file.size;
              const percent = bytes > 0 ? Math.round(Math.min(100, loaded / bytes * 100)) : 100;
              setFileUploadProgress({ name: file.name, percent });
            },
          });
        } catch (error) {
          if (generation !== generationRef.current || controller.signal.aborted) return;
          throw error;
        } finally {
          uploadControllersRef.current.delete(controller);
        }
        if (generation !== generationRef.current) return;
        inputFilesRef.current = [...inputFilesRef.current, staged];
        setInputFiles(inputFilesRef.current);
      }
    } finally {
      pendingUploadsRef.current -= 1;
      setFilesUploading(pendingUploadsRef.current > 0);
      if (pendingUploadsRef.current === 0) setFileUploadProgress(null);
    }
  }

  function removeInputFile(id) {
    inputFilesRef.current = inputFilesRef.current.filter((item) => item.id !== id);
    setInputFiles(inputFilesRef.current);
  }

  function clearInputFiles() {
    inputFilesRef.current = [];
    setInputFiles([]);
  }

  function discardInputFiles() {
    generationRef.current += 1;
    abortUploads();
    clearInputFiles();
    setFileUploadProgress(null);
  }

  return { inputFiles, inputFilesRef, filesUploading, fileUploadProgress, addInputFiles, removeInputFile, clearInputFiles, discardInputFiles };
}
