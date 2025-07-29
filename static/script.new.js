import { initShimmer, showShimmer, hideShimmer } from './shimmer.js';

document.addEventListener('DOMContentLoaded', () => {
  // Инициализация shimmer эффекта
  initShimmer();

  // Основные элементы UI
  const photoInput = document.getElementById('photoInput');
  const photoPreview = document.getElementById('photoPreview');
  const photoUploadContainer = document.querySelector('.photo-upload-container');
  const uploadPlaceholder = document.querySelector('.upload-placeholder');

  // Переменные для управления зумом и панорамированием
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let startX = 0;
  let startY = 0;
  let isPanning = false;

  // Функции для работы с кэшем
  function saveToCache(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error('Error saving to cache:', e);
    }
  }

  function loadFromCache(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error('Error loading from cache:', e);
      return null;
    }
  }

  // Функции управления фото
  function resetZoom() {
    scale = 1;
    translateX = 0;
    translateY = 0;
    updateTransform();
  }

  function updateTransform() {
    photoPreview.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }

  function loadSavedPhoto() {
    const savedPhoto = loadFromCache('uploadedPhoto');
    if (savedPhoto) {
      showShimmer();
      
      setTimeout(() => {
        photoPreview.src = savedPhoto;
        photoPreview.onload = () => {
          hideShimmer();
          document.querySelector('.photo-preview').classList.add('active');
          photoUploadContainer.removeEventListener('click', handlePhotoUpload);
          photoInput.disabled = true;
          photoUploadContainer.style.cursor = 'default';
          if (uploadPlaceholder) {
            uploadPlaceholder.remove();
          }
        };
      }, 1000);
    }
  }

  function handlePhotoUpload() {
    photoInput.click();
  }

  // Обработчики для панорамирования фото
  photoPreview.addEventListener('pointerdown', (e) => {
    isPanning = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    photoPreview.style.cursor = 'grabbing';
  });

  document.addEventListener('pointermove', (e) => {
    if (!isPanning) return;
    
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    updateTransform();
  });

  document.addEventListener('pointerup', () => {
    isPanning = false;
    photoPreview.style.cursor = 'grab';
  });

  document.addEventListener('pointercancel', () => {
    isPanning = false;
    photoPreview.style.cursor = 'grab';
  });

  // Обработчик загрузки фото
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      showShimmer();
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const photoData = e.target.result;
        photoPreview.src = photoData;
        
        photoPreview.onload = () => {
          hideShimmer();
          uploadPlaceholder.style.display = 'none';
          document.querySelector('.photo-preview').classList.add('active');
          resetZoom();
          
          photoUploadContainer.removeEventListener('click', handlePhotoUpload);
          photoInput.disabled = true;
          photoUploadContainer.style.cursor = 'default';
          if (uploadPlaceholder) {
            uploadPlaceholder.remove();
          }
          
          saveToCache('uploadedPhoto', photoData);
        };
      };
      reader.readAsDataURL(file);
    }
  });

  // Инициализация
  photoUploadContainer.addEventListener('click', handlePhotoUpload);
  loadSavedPhoto();
});