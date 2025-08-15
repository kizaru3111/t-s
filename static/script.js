document.addEventListener('DOMContentLoaded', () => {
  const slider = document.querySelector('.slider');
  const tabLabels = document.querySelectorAll('.tab-label');
  let currentPage = 1;

  // Photo upload related elements
  const photoUploadContainer = document.querySelector('.photo-upload-container');
  const photoInput = document.getElementById('photoInput');
  const photoPreview = document.getElementById('photoPreview');
  const uploadPlaceholder = document.querySelector('.upload-placeholder');

  // Update zoom-related variables
  let currentScale = 1;
  let initialScale = 1; 
  let lastCenter = { x: 0, y: 0 };
  let initialDistance = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let translateX = 0;
  let translateY = 0;
  let lastTranslateX = 0;
  let lastTranslateY = 0;
  const MIN_SCALE = 0.5;  // Minimum zoom level
  const MAX_SCALE = 3;    // Maximum zoom level
  const RESET_THRESHOLD = 0.8; // Threshold for auto-reset when zooming out
  let isAnimating = false;

  let lastTouchTime = 0;
  let touchTimeout = null;
  let isTwoFingerGesture = false;

  // Add smooth animation function
  function animateTransform(targetScale, targetX, targetY, duration = 300) {
    if (isAnimating) return;
    isAnimating = true;
    
    const startScale = currentScale;
    const startX = translateX;
    const startY = translateY;
    const startTime = performance.now();
    
    // Improved easing function for more natural feel
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
    
    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);
      
      currentScale = startScale + (targetScale - startScale) * easedProgress;
      translateX = startX + (targetX - startX) * easedProgress;
      translateY = startY + (targetY - startY) * easedProgress;
      
      updateTransform();
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        isAnimating = false;
        lastTranslateX = translateX;
        lastTranslateY = translateY;
        // Update initial values for next interaction
        initialScale = currentScale;
      }
    }
    
    requestAnimationFrame(animate);
  }

  photoPreview.addEventListener('touchstart', (e) => {
    if (isAnimating) return;
    
    // Clear any existing timeout to prevent false double-tap detection
    if (touchTimeout) {
      clearTimeout(touchTimeout);
    }

    if (e.touches.length === 2) {
      // Two finger gesture started
      e.preventDefault();
      isTwoFingerGesture = true;
      initialDistance = getDistance(e.touches[0], e.touches[1]);
      initialScale = currentScale;
      lastCenter = getCenter(e.touches[0], e.touches[1]);
    } else if (e.touches.length === 1) {
      // Single finger touch
      const now = Date.now();
      const timeSinceLastTouch = now - lastTouchTime;
      
      if (timeSinceLastTouch < 300) { // Double tap detected
        e.preventDefault();
        handleDoubleTap(e.touches[0]);
        lastTouchTime = 0; // Reset to prevent triple-tap detection
      } else {
        // Set a timeout to differentiate between tap and hold
        touchTimeout = setTimeout(() => {
          if (!isTwoFingerGesture) {
            isDragging = true;
            startX = e.touches[0].clientX - lastTranslateX;
            startY = e.touches[0].clientY - lastTranslateY;
          }
        }, 100);
        
        lastTouchTime = now;
      }
    }
  }, { passive: false });

  photoPreview.addEventListener('touchmove', (e) => {
    if (isAnimating) return;

    if (e.touches.length === 2 && isTwoFingerGesture) {
      e.preventDefault();
      const distance = getDistance(e.touches[0], e.touches[1]);
      const newScale = initialScale * (distance / initialDistance);
      
      // Apply scale constraints
      currentScale = Math.min(Math.max(newScale, MIN_SCALE), MAX_SCALE);
      
      const center = getCenter(e.touches[0], e.touches[1]);
      
      // Get container and image dimensions
      const containerRect = photoPreview.parentElement.getBoundingClientRect();
      const imageRect = photoPreview.getBoundingClientRect();
      
      // Calculate new position with boundary checking
      const proposedX = lastTranslateX + (center.x - lastCenter.x);
      const proposedY = lastTranslateY + (center.y - lastCenter.y);
      
      // Clamp translations within bounds
      translateX = clampTranslation(proposedX, imageRect.width, currentScale, containerRect.width);
      translateY = clampTranslation(proposedY, imageRect.height, currentScale, containerRect.height);
      
      lastCenter = center;
      updateTransform();

      if (currentScale <= RESET_THRESHOLD) {
        animateTransform(1, 0, 0);
      }
    } else if (e.touches.length === 1 && isDragging && currentScale > 1 && !isTwoFingerGesture) {
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      
      // Get container and image dimensions
      const containerRect = photoPreview.parentElement.getBoundingClientRect();
      const imageRect = photoPreview.getBoundingClientRect();
      
      // Clamp translations within bounds
      translateX = clampTranslation(deltaX, imageRect.width, currentScale, containerRect.width);
      translateY = clampTranslation(deltaY, imageRect.height, currentScale, containerRect.height);
      
      updateTransform();
    }
  });

  photoPreview.addEventListener('touchend', (e) => {
    // Clear the timeout to prevent false drag detection
    if (touchTimeout) {
      clearTimeout(touchTimeout);
    }

    if (e.touches.length === 0) {
      // All fingers lifted
      isTwoFingerGesture = false;
      isDragging = false;
      initialScale = currentScale;
      lastTranslateX = translateX;
      lastTranslateY = translateY;

      // If scale is below threshold, animate back to initial position
      if (currentScale <= RESET_THRESHOLD) {
        animateTransform(1, 0, 0);
      }
    }
  });

  // Add touchcancel handler to reset gesture states
  photoPreview.addEventListener('touchcancel', () => {
    isTwoFingerGesture = false;
    isDragging = false;
    if (touchTimeout) {
      clearTimeout(touchTimeout);
    }
  });

  // Add double tap handler
  function handleDoubleTap(touch) {
    const containerRect = photoPreview.parentElement.getBoundingClientRect();
    const imageRect = photoPreview.getBoundingClientRect();
    
    const touchX = touch.clientX - containerRect.left;
    const touchY = touch.clientY - containerRect.top;
    
    if (currentScale > 1.1) {
      animateTransform(1, 0, 0);
    } else {
      const targetScale = 2.5;
      
      // Calculate the focal point for zooming
      const focusX = touchX - containerRect.width / 2;
      const focusY = touchY - containerRect.height / 2;
      
      // Calculate target position with boundary checking
      const targetX = clampTranslation(
        -focusX * targetScale / currentScale,
        imageRect.width,
        targetScale,
        containerRect.width
      );
      const targetY = clampTranslation(
        -focusY * targetScale / currentScale,
        imageRect.height,
        targetScale,
        containerRect.height
      );
      
      animateTransform(targetScale, targetX, targetY);
    }
  }

  // Optimize transform update with requestAnimationFrame
  let transformRequestId = null;
  function updateTransform() {
    if (transformRequestId) return;
    
    transformRequestId = requestAnimationFrame(() => {
      const transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${currentScale})`;
      photoPreview.style.transform = transform;
      transformRequestId = null;
    });
  }

  // Helper function to calculate distance between two touch points
  function getDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Helper function to calculate center point between two touches
  function getCenter(touch1, touch2) {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2
    };
  }

  // Helper function to clamp translation
  function clampTranslation(translation, dimension, scale, containerDimension) {
    // Calculate maximum allowed translation based on current scale
    const scaledDimension = dimension * scale;
    const maxTranslation = Math.max(0, (scaledDimension - containerDimension) / 2);
    
    // Clamp translation between negative and positive maxTranslation
    return Math.min(Math.max(translation, -maxTranslation), maxTranslation);
  }

  // Prevent default browser zoom behavior
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  // Add momentum scrolling when dragging
  let velocityX = 0;
  let velocityY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastMoveTime = 0;

  photoPreview.addEventListener('touchmove', (e) => {
    const now = performance.now();
    const deltaTime = now - lastMoveTime;
    
    if (e.touches.length === 1 && isDragging && currentScale > 1) {
      const touch = e.touches[0];
      const currentX = touch.clientX;
      const currentY = touch.clientY;
      
      if (lastMoveTime) {
        velocityX = (currentX - lastX) / deltaTime;
        velocityY = (currentY - lastY) / deltaTime;
      }
      
      lastX = currentX;
      lastY = currentY;
      lastMoveTime = now;
    }
  }, { passive: true });

  photoPreview.addEventListener('touchend', (e) => {
    if (isDragging && currentScale > 1 && (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1)) {
      const containerRect = photoPreview.parentElement.getBoundingClientRect();
      const imageRect = photoPreview.getBoundingClientRect();
      const decayFactor = 0.95;
      
      const animateDecay = () => {
        if (Math.abs(velocityX) < 0.01 && Math.abs(velocityY) < 0.01) {
          return;
        }
        
        const newX = translateX + velocityX * 16;
        const newY = translateY + velocityY * 16;
        
        // Apply clamping to new positions
        translateX = clampTranslation(newX, imageRect.width, currentScale, containerRect.width);
        translateY = clampTranslation(newY, imageRect.height, currentScale, containerRect.height);
        
        velocityX *= decayFactor;
        velocityY *= decayFactor;
        
        updateTransform();
        requestAnimationFrame(animateDecay);
      };
      
      requestAnimationFrame(animateDecay);
    }
    
    isDragging = false;
    lastMoveTime = 0;
  });

  // Update reset zoom function
  function resetZoom() {
    animateTransform(1, 0, 0);
  }

  // Modify existing photo upload handler
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        photoPreview.src = e.target.result;
        photoPreview.onload = () => {
          uploadPlaceholder.style.display = 'none';
          document.querySelector('.photo-preview').classList.add('active');
          resetZoom(); // Reset zoom when new image is loaded
        };
      };
      reader.readAsDataURL(file);
    }
  });

  // Add click event listeners to tab labels
  tabLabels.forEach((label, index) => {
    label.addEventListener('click', () => {
      switchToPage(index + 1);
    });
  });

  // Add touch swipe functionality
  const content = document.querySelector('#content');
  let touchStartX = 0;
  let touchEndX = 0;
  let contentStartX = 0;

  content.addEventListener('touchstart', (e) => {
    // Проверяем, не находится ли точка касания в нижней части экрана
    const touchY = e.touches[0].clientY;
    const windowHeight = window.innerHeight;
    const bottomThreshold = windowHeight - 150; // 20px от нижнего края

    if (touchY > bottomThreshold) {
      touchStartX = 0; // Сбрасываем начальную позицию, чтобы предотвратить свайп
      return;
    }

    touchStartX = e.touches[0].clientX;
    contentStartX = content.getBoundingClientRect().x;
    content.style.transition = 'none';
  });

  content.addEventListener('touchmove', (e) => {
    // Если начальная позиция не установлена (касание началось в нижней части), игнорируем свайп
    if (touchStartX === 0) return;

    const deltaX = e.touches[0].clientX - touchStartX;
    const newX = contentStartX + deltaX;
    
    // Allow dragging in both directions regardless of current page
    const translateX = (currentPage === 1 ? 0 : -50) + (deltaX / window.innerWidth * 100);
    
    // Limit the drag to reasonable bounds
    if (translateX > 0 || translateX < -50) return;
    
    content.style.transform = `translateX(${translateX}%)`;
  });

  content.addEventListener('touchend', (e) => {
    // Если начальная позиция не установлена (касание началось в нижней части), игнорируем свайп
    if (touchStartX === 0) return;

    content.style.transition = 'transform 0.3s ease-in-out';
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    
    // If swipe is more than 1/4 of screen width, switch pages
    if (Math.abs(deltaX) > window.innerWidth / 4) {
      if (deltaX < 0 && currentPage === 1) {
        switchToPage(2);
      } else if (deltaX > 0 && currentPage === 2) {
        switchToPage(1);
      } else {
        // Reset to current page
        content.style.transform = `translateX(${currentPage === 1 ? 0 : -50}%)`;
      }
    } else {
      // Reset to current page if swipe wasn't far enough
      content.style.transform = `translateX(${currentPage === 1 ? 0 : -50}%)`;
    }
  });

  // Update switchToPage function
  function switchToPage(pageNum) {
    currentPage = pageNum;
    
    if (pageNum === 1) {
      content.style.transform = 'translateX(0)';
      tabLabels[0].classList.add('active');
      tabLabels[1].classList.remove('active');
      document.querySelector('.bottom-buttons').style.display = 'flex';
      document.querySelector('.bottom-button-page2').style.display = 'none';
    } else {
      content.style.transform = 'translateX(-50%)';
      tabLabels[0].classList.remove('active');
      tabLabels[1].classList.add('active');
      document.querySelector('.bottom-buttons').style.display = 'none';
      document.querySelector('.bottom-button-page2').style.display = 'flex';
    }
  }

  // Initialize first page
  switchToPage(1);

  // Simple photo upload functionality (without interactions)
  const handlePhotoUpload = () => {
    photoInput.click();
  };
  photoUploadContainer.addEventListener('click', handlePhotoUpload);

  // Modify existing photo upload handler
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        photoPreview.src = e.target.result;
        photoPreview.onload = () => {
          uploadPlaceholder.style.display = 'none';
          document.querySelector('.photo-preview').classList.add('active');
          resetZoom(); // Reset zoom when new image is loaded
          
          // Disable further uploads while keeping touch interactions
          photoUploadContainer.removeEventListener('click', handlePhotoUpload);
          photoInput.disabled = true;
          
          // Remove visual cues for upload functionality
          photoUploadContainer.style.cursor = 'default';
          uploadPlaceholder.remove(); // Полностью удаляем плейсхолдер
        };
      };
      reader.readAsDataURL(file);
    }
  });

  // Функция инициализации кнопок копирования
  function initializeCopyButtons() {
    const textInputs = document.querySelectorAll('.input-row input');
    
    // Создаем уведомление один раз
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Скопировано</span>
    `;
    document.body.appendChild(notification);

    textInputs.forEach(input => {
      // Проверяем существование родительского элемента
      if (!input.parentNode) return;

      // Удаляем старую кнопку если она есть
      const oldButton = input.parentNode.querySelector('.copy-button');
      if (oldButton) oldButton.remove();

      // Создаем новую кнопку
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-button';
      copyButton.innerHTML = `
        <img src="/static/copy_icon.png" width="20" height="20" alt="Copy">
      `;
      copyButton.style.display = 'none';
      input.parentNode.appendChild(copyButton);

      // Показываем кнопку если поле уже заполнено
      if (input.value.trim()) {
        copyButton.style.display = 'flex';
        input.classList.add('filled');
      }

      // Обработчик изменения
      input.addEventListener('input', function() {
        const hasValue = this.value.trim().length > 0;
        copyButton.style.display = hasValue ? 'flex' : 'none';
      });

      // Обработчик копирования
      copyButton.addEventListener('click', function() {
        // Создаем функцию для показа уведомления
        const showNotification = () => {
          notification.classList.add('visible');
          setTimeout(() => notification.classList.remove('visible'), 2000);
        };

        // Пробуем использовать современный API
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value)
            .then(showNotification)
            .catch(() => {
              // Если современный API не сработал, используем fallback
              copyTextFallback(input.value);
              showNotification();
            });
        } else {
          // Если современный API недоступен, сразу используем fallback
          copyTextFallback(input.value);
          showNotification();
        }
      });

      // Вспомогательная функция для копирования текста через execCommand
      function copyTextFallback(text) {
        const tempInput = document.createElement('textarea');
        tempInput.style.position = 'absolute';
        tempInput.style.left = '-9999px';
        tempInput.value = text;
        document.body.appendChild(tempInput);
        tempInput.select();
        try {
          document.execCommand('copy');
        } catch (err) {
          console.log('Fallback копирование не сработало', err);
        }
        document.body.removeChild(tempInput);
      }
    });
  }

  // Вызываем инициализацию после загрузки страницы
  initializeCopyButtons();

  // QR Code Modal Functionality
  const showDocumentButton = document.querySelector('.btn-primary');
  const qrModal = document.querySelector('.qr-modal');
  const qrModalOverlay = document.querySelector('.qr-modal-overlay');
  const qrModalClose = document.querySelector('.qr-modal-close');
  const qrCodeContainer = document.getElementById('qrCodeContainer');

  let modalStartY = 0;
  let modalCurrentY = 0;
  let modalInitialY = 0;
  let isModalDragging = false;

  // Touch event handlers
  qrModal.addEventListener('touchstart', (e) => {
    modalStartY = e.touches[0].clientY;
    modalInitialY = qrModal.getBoundingClientRect().top;
    isModalDragging = true;
    qrModal.style.transition = 'none';
  });

  qrModal.addEventListener('touchmove', (e) => {
    if (!isModalDragging) return;
    
    e.preventDefault();
    modalCurrentY = e.touches[0].clientY;
    const deltaY = modalCurrentY - modalStartY;
    
    // Only allow dragging downwards from initial position
    if (deltaY < 0) return;
    
    qrModal.style.transform = `translateY(${deltaY}px)`;
    
    // Calculate opacity based on drag distance
    const opacity = Math.max(0, 1 - (deltaY / window.innerHeight));
    qrModalOverlay.style.opacity = opacity;
  });

  qrModal.addEventListener('touchend', () => {
    if (!isModalDragging) return;
    isModalDragging = false;
    qrModal.style.transition = 'all 0.3s ease-out';
    
    const deltaY = modalCurrentY - modalStartY;
    const threshold = window.innerHeight * 0.2; // 20% of screen height
    
    if (deltaY > threshold) {
      // Close the modal if dragged down far enough
      qrModal.style.transform = `translateY(${window.innerHeight}px)`;
      qrModalOverlay.style.opacity = '0';
      setTimeout(() => {
        qrModal.classList.remove('show');
        qrModalOverlay.classList.remove('show');
        qrModal.style.transform = '';
      }, 300);
    } else {
      // Reset position if not dragged far enough
      qrModal.style.transform = '';
      qrModalOverlay.style.opacity = '1';
    }
  });

  // Function to generate a hash from a string
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // Function to get device-specific identifier
  function getDeviceIdentifier() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Combine various device characteristics
    const deviceInfo = [
      navigator.userAgent,
      screen.width,
      screen.height,
      screen.colorDepth,
      navigator.language,
      new Date().getTimezoneOffset()
    ].join('|');

    return simpleHash(deviceInfo).toString();
  }

  // Generate dynamic QR code content
  function generateDynamicQRContent() {
    // Get current hour
    const currentHour = new Date().getHours();
    
    // Get device-specific identifier
    const deviceId = getDeviceIdentifier();
    
    // Combine hour and device ID to create a unique seed
    const seed = `${currentHour}-${deviceId}`;
    
    // Generate a predictable but varied 128-character string
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < 128; i++) {
      const hashValue = simpleHash(seed + i);
      result += characters[hashValue % characters.length];
    }
    
    return result;
  }

  // Generate QR Code
  function generateQRCode() {
    const qrContent = generateDynamicQRContent();
    const qr = qrcode(0, 'M');
    qr.addData(qrContent);
    qr.make();
    qrCodeContainer.innerHTML = qr.createImgTag(5);
  }

  showDocumentButton.addEventListener('click', () => {
    generateQRCode();
    qrModal.classList.add('show');
    qrModalOverlay.classList.add('show');
    // Set initial opacity to match the modal's entrance
    qrModalOverlay.style.opacity = '1';
  });

  qrModalClose.addEventListener('click', () => {
    qrModal.classList.remove('show');
    qrModalOverlay.classList.remove('show');
  });

  qrModalOverlay.addEventListener('click', () => {
    qrModal.classList.remove('show');
    qrModalOverlay.classList.remove('show');
    qrModalOverlay.style.opacity = '0';
  });

  // Regenerate QR code every hour
  setInterval(generateQRCode, 60 * 60 * 1000);

  // Обновляем функционал загрузки
  const loadingOverlay = document.querySelector('.loading-overlay');
  
  function showLoading() {
    loadingOverlay.classList.add('show');
    setTimeout(() => {
      loadingOverlay.classList.remove('show');
    }, 100); // Изменено с 500 на 200 мс
  }

  // Обработчик для кнопки "Отправить документ"
  const sendDocumentButton = document.querySelector('.bottom-buttons .btn-secondary');
  sendDocumentButton.addEventListener('click', showLoading);

  // Обработчик для кнопки "Отправить реквизиты"
  const sendRequisitesButton = document.querySelector('.bottom-button-page2 .btn-secondary');
  sendRequisitesButton.addEventListener('click', showLoading);

  // Функции для работы с кэшем
  function saveToCache(key, value) {
    localStorage.setItem(key, value);
  }

  function loadFromCache(key) {
    return localStorage.getItem(key);
  }

  // Загрузка сохраненных текстовых данных
  function loadSavedInputs() {
    const textInputs = document.querySelectorAll('.input-row input');
    textInputs.forEach(input => {
      const key = input.getAttribute('placeholder');
      const savedValue = loadFromCache(key);
      if (savedValue) {
        input.value = savedValue;
        input.readOnly = true;
        input.classList.add('filled');
        // Переинициализируем кнопки после загрузки данных
        initializeCopyButtons();
      }
    });
  }

  // Загрузка сохраненного фото
  function loadSavedPhoto() {
    const savedPhoto = loadFromCache('uploadedPhoto');
    if (savedPhoto) {
      photoPreview.src = savedPhoto;
      photoPreview.onload = () => {
        uploadPlaceholder.style.display = 'none';
        document.querySelector('.photo-preview').classList.add('active');
        // Отключаем дальнейшую загрузку фото
        photoUploadContainer.removeEventListener('click', handlePhotoUpload);
        photoInput.disabled = true;
        photoUploadContainer.style.cursor = 'default';
        if (uploadPlaceholder) {
          uploadPlaceholder.remove();
        }
      };
    }
  }

  // Вызываем загрузку при старте
  loadSavedInputs();
  loadSavedPhoto();

  // Обновляем обработчики текстовых полей
  const textInputs = document.querySelectorAll('.input-row input');
  textInputs.forEach(input => {
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button';
    copyButton.innerHTML = `
      <img src="/static/copy_icon.png" width="20" height="20" alt="Copy">
    `;
    copyButton.style.display = 'none';
    input.parentNode.appendChild(copyButton);

    input.addEventListener('change', function() {
      if (this.value.trim()) {
        this.readOnly = true;
        this.classList.add('filled');
        copyButton.style.display = 'flex';
        // Сохраняем значение в кэш
        saveToCache(this.placeholder, this.value.trim());
      }
    });

    copyButton.addEventListener('click', function() {
      navigator.clipboard.writeText(input.value).then(() => {
        const notification = document.querySelector('.copy-notification');
        notification.classList.add('visible');
        setTimeout(() => {
          notification.classList.remove('visible');
        }, 2000);
      });
    });

    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && this.value.trim()) {
        this.blur();
        this.readOnly = true;
        this.classList.add('filled');
        copyButton.style.display = 'flex';
        // Сохраняем значение в кэш
        saveToCache(this.placeholder, this.value.trim());
      }
    });
  });

  // Обновляем обработчик загрузки фото
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const photoData = e.target.result;
        photoPreview.src = photoData;
        // Сохраняем фото в кэш
        saveToCache('uploadedPhoto', photoData);
        
        photoPreview.onload = () => {
          uploadPlaceholder.style.display = 'none';
          document.querySelector('.photo-preview').classList.add('active');
          resetZoom();
          
          photoUploadContainer.removeEventListener('click', handlePhotoUpload);
          photoInput.disabled = true;
          photoUploadContainer.style.cursor = 'default';
          if (uploadPlaceholder) {
            uploadPlaceholder.remove();
          }
        };
      };
      reader.readAsDataURL(file);
    }
  });

  // Добавляем обработчик сообщений от сервис-воркера
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'SESSION_EXPIRED') {
      // Очищаем данные сессии
      localStorage.removeItem('session_data');
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('expires_at');
      // Перенаправляем на страницу входа
      window.location.href = '/login?no_redirect=1';
    }
    else if (event.data.type === 'GET_TOKEN') {
      // Отправляем токен сервис-воркеру
      event.ports[0].postMessage(localStorage.getItem('jwt_token'));
    }
  });

  // Функция для проверки обновления сессии
  async function checkSessionUpdate() {
    const sessionData = localStorage.getItem('session_data');
    if (!sessionData) return;

    const data = JSON.parse(sessionData);
    try {
      const response = await fetch('/api/session_updated', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: data.user_id,
          session_id: data.session_id
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.status === 'updated') {
          // Обновляем данные сессии в localStorage
          data.expires_at = result.expires_at;
          localStorage.setItem('session_data', JSON.stringify(data));
          // Перезагружаем страницу для применения изменений
          window.location.reload();
        }
      }
    } catch (error) {
      console.error('Failed to check session update:', error);
    }
  }

  // Добавляем периодическую проверку обновления сессии
  setInterval(checkSessionUpdate, 5000);
});