import mysql.connector
from flask import Flask, render_template, request, redirect, session, url_for, jsonify, make_response
from datetime import datetime, timedelta
import secrets
import logging
from functools import wraps
import jwt
import os
import time
from dotenv import load_dotenv

# Загружаем переменные окружения из .env файла
load_dotenv()

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY')  # Получаем из переменной окружения
app.permanent_session_lifetime = timedelta(days=1)
app.config['SESSION_REFRESH_EACH_REQUEST'] = False  # Важно: отключаем автообновление
app.config['SESSION_REFRESH_INTERVAL'] = 300  # Интервал обновления 5 минут

# Добавляем защиту от частых запросов
last_session_check = {}

def can_check_session(user_id):
    """Ограничиваем частоту проверки сессии"""
    now = datetime.now()
    if user_id in last_session_check:
        time_diff = (now - last_session_check[user_id]).total_seconds()
        if time_diff < 30:  # Минимум 30 секунд между проверками
            return False
    last_session_check[user_id] = now
    return True

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET_KEY')  # Получаем из переменной окружения
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION = timedelta(days=1)

# Database Configuration
MYSQL_CONFIG = {
    'host': os.environ.get('DB_HOST', 'db4free.net'),
    'user': os.environ.get('DB_USER', 'zhantik31'),
    'password': os.environ.get('DB_PASSWORD', 'randome21'),
    'database': os.environ.get('DB_NAME', 'access_data'),
    'connect_timeout': 30,  # Увеличиваем таймаут подключения
    'connection_timeout': 30,
    'compress': True,  # Сжатие данных для медленных соединений
    'buffered': True  # Буферизация для улучшения производительности
}

def get_db():
    """Установка соединения с базой данных"""
    retries = 5  # вместо текущих 3
    delay = 1  # начальная задержка в секундах
    
    for attempt in range(retries):
        try:
            logger.info(f"Attempting to connect to database at {MYSQL_CONFIG['host']} (attempt {attempt + 1}/{retries})")
            conn = mysql.connector.connect(**MYSQL_CONFIG)
            conn.autocommit = True
            logger.info("Database connection successful")
            return conn
        except mysql.connector.Error as e:
            logger.error(f"Database connection error (attempt {attempt + 1}/{retries}): {str(e)}")
            if attempt < retries - 1:
                logger.info(f"Retrying in {delay} seconds...")
                time.sleep(delay)
                delay *= 2  # увеличиваем задержку экспоненциально
            else:
                raise

def init_db():
    """Инициализация базы данных"""
    with get_db() as conn:
        cursor = conn.cursor()
        # Таблица кодов доступа
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS codes (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                user_id INTEGER NOT NULL,
                code VARCHAR(255) UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                tariff VARCHAR(255),
                is_used BOOLEAN DEFAULT FALSE,
                session_id VARCHAR(255),
                needs_refresh BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Таблица логов доступа
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS access_logs (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                user_id INTEGER NOT NULL,
                code VARCHAR(255) NOT NULL,
                ip_address VARCHAR(255) NOT NULL,
                user_agent TEXT,
                login_time DATETIME NOT NULL,
                logout_time DATETIME,
                session_id VARCHAR(255)
            )
        ''')
        
        # Таблица пользователей (добавлена для будущего расширения)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                telegram_id INTEGER UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

def create_jwt_token(user_id):
    """Генерация JWT токена"""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + JWT_EXPIRATION,
        'session_id': secrets.token_hex(16),
        'iss': 'auth-service'
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_jwt_token(token):
    """Проверка JWT токена"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def auth_required(f):
    """Универсальный декоратор для проверки авторизации"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Для API/PWA запросов проверяем JWT
        if request.path.startswith('/api/'):
            auth_header = request.headers.get('Authorization')
            if not auth_header or not auth_header.startswith('Bearer '):
                return jsonify({"error": "Требуется авторизация"}), 401
            
            token = auth_header.split(' ')[1]
            payload = verify_jwt_token(token)
            if not payload:
                return jsonify({"error": "Неверный токен"}), 401
            
            # Проверяем активность сессии в БД
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT 1 FROM codes 
                    WHERE user_id = %s AND session_id = %s AND is_used = 1 AND expires_at > %s
                ''', (payload['user_id'], payload.get('session_id'), datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
                active_session = cursor.fetchone()
                
                if not active_session:
                    return jsonify({"error": "Сессия истекла"}), 401
            
            request.user_id = payload['user_id']
            return f(*args, **kwargs)
        
        # Для обычных запросов проверяем сессию
        if 'user_id' not in session:
            return redirect(url_for('login_page'))
        
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
@auth_required
def home():
    """Главная страница"""
    with get_db() as conn:
        cursor = conn.cursor(dictionary=True)
        cursor.execute('''
            SELECT expires_at FROM codes 
            WHERE user_id = %s AND session_id = %s AND is_used = TRUE
        ''', (session['user_id'], session.get('session_id')))
        user_data = cursor.fetchone()
        
        if not user_data:
            session.clear()
            return redirect(url_for('login_page'))
        
        return render_template('dashboard.html',
                            user_id=session['user_id'],
                            expires_at=str(user_data['expires_at']))

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    """Страница входа"""
    try:
        # Проверка существующей сессии
        if not request.args.get('no_redirect') and 'user_id' in session and session.get('session_id'):
            with get_db() as conn:
                cursor = conn.cursor(dictionary=True)
                cursor.execute('''
                    SELECT 1 FROM codes 
                    WHERE user_id = %s AND session_id = %s AND is_used = 1 AND expires_at > %s
                ''', (session['user_id'], session['session_id'], datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
                session_active = cursor.fetchone()
                
                if session_active:
                    return redirect(url_for('dashboard'))

        # Обработка POST-запроса (попытка входа)
        if request.method == 'POST':
            code = request.form.get('code', '').strip()  # Оставляем код как есть
            app.logger.info(f"Attempting login with code: '{code}', length: {len(code)}")
            
            if not code or len(code) != 8:  # Проверяем правильную длину кода
                app.logger.warning(f"Invalid code format. Code must be 8 characters long. Got length: {len(code) if code else 0}")
                return jsonify({"error": "Неверный формат кода"}), 401
            
            try:
                with get_db() as conn:
                    cursor = conn.cursor(dictionary=True)
                    
                    # Сначала проверяем, существует ли такой код вообще
                    cursor.execute('''
                        SELECT c.user_id, c.expires_at, c.is_used, c.code
                        FROM codes c 
                        WHERE BINARY c.code = %s
                    ''', (code,))  # Используем BINARY для точного сравнения
                    code_data = cursor.fetchone()
                    
                    if not code_data:
                        # Пробуем поискать код в нижнем регистре
                        cursor.execute('''
                            SELECT c.user_id, c.expires_at, c.is_used, c.code
                            FROM codes c 
                            WHERE BINARY c.code = %s
                        ''', (code.lower(),))
                        code_data = cursor.fetchone()
                        
                    if not code_data:
                        app.logger.warning(f"Code not found in database: '{code}'")
                        return jsonify({"error": "Неверный код"}), 401
            except Exception as e:
                app.logger.error(f"Database error during code check: {str(e)}")
                return jsonify({"error": "Ошибка проверки кода. Попробуйте позже."}), 500
                code_data = cursor.fetchone()
                
                if not code_data:
                    app.logger.warning(f"Code not found in database: '{code}'. Looking for similar codes...")
                    # Ищем похожие коды для отладки
                    cursor.execute('''
                        SELECT c.code, c.is_used
                        FROM codes c
                        WHERE c.code LIKE %s
                        LIMIT 5
                    ''', (f"%{code}%",))
                    similar_codes = cursor.fetchall()
                    if similar_codes:
                        app.logger.info(f"Found similar codes: {[c['code'] for c in similar_codes]}")
                    return jsonify({"error": "Неверный код"}), 401
                
                app.logger.info(f"Found code: {code_data}")
                current_time = datetime.now()
                
                if code_data:
                    # Проверяем, не использован ли уже код
                    if code_data['is_used']:
                        app.logger.warning("Попытка использовать уже активированный код")
                        return jsonify({"error": "Этот код уже был активирован"}), 401
                    
                    # Проверяем, не истек ли срок действия кода
                    expires_at = code_data['expires_at']
                    if expires_at < current_time:
                        app.logger.warning("Попытка использовать просроченный код")
                        return jsonify({"error": "Срок действия кода истек"}), 401
                    
                    session_id = secrets.token_hex(16)
                    session.permanent = True
                    
                    cursor.execute('''
                        UPDATE codes 
                        SET is_used = TRUE, 
                            session_id = %s,
                            last_used_at = %s
                        WHERE code = %s
                    ''', (session_id, current_time.strftime("%Y-%m-%d %H:%M:%S"), code))
                    conn.commit()
                    
                    session['user_id'] = code_data['user_id']
                    session['session_id'] = session_id
                    session['expires_at'] = str(code_data['expires_at'])
                    app.logger.info(f"Successful login for user_id: {code_data['user_id']}")
                    
                    return redirect(url_for('dashboard'))
                
                app.logger.warning(f"Invalid code attempt. Code format is incorrect or code doesn't exist. Code: '{code}'")
                return jsonify({"error": "Неверный или просроченный код!"}), 401

        # GET-запрос - показываем страницу входа
        response = make_response(render_template('login.html'))
        response.headers['Cache-Control'] = 'no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({"error": "Ошибка сервера", "details": str(e)}), 500

@app.route('/api/login', methods=['POST'])
def api_login():
    try:
        data = request.get_json()
        code = data.get('code', '').strip().upper()
        
        with get_db() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute('''
                SELECT user_id, expires_at FROM codes 
                WHERE code = %s AND is_used = FALSE AND expires_at > %s
            ''', (code, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
            code_data = cursor.fetchone()
            
            if code_data:
                session_id = secrets.token_hex(16)
                cursor.execute('''
                    UPDATE codes 
                    SET is_used = TRUE, session_id = %s, needs_refresh = FALSE
                    WHERE code = %s
                ''', (session_id, code))
                conn.commit()
                
                # Создаем JWT токен с увеличенным сроком действия
                token = create_jwt_token(code_data['user_id'])
                
                response = jsonify({
                    'token': token,
                    'expires_at': str(code_data['expires_at'])
                })
                
                # Устанавливаем куки для JWT токена
                max_age = 24 * 60 * 60  # 24 часа
                response.set_cookie(
                    'auth_token',
                    token,
                    max_age=max_age,
                    httponly=True,
                    secure=True,
                    samesite='Strict'
                )
                
                return response
        
        return jsonify({'error': 'Неверный код'}), 401
        
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'error': 'Ошибка сервера'}), 500

@app.route('/api/session_data')
def get_session_data():
    if 'user_id' not in session:
        return jsonify({"error": "No active session"}), 401
    
    return jsonify({
        "user_id": session['user_id'],
        "session_id": session['session_id'],
        "expires_at": session['expires_at']
    })

@app.route('/api/check_session')
def check_session_status():
    # Запрещаем кэширование для точной проверки времени
    response_headers = {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
    }
    
    # Проверяем сначала Bearer токен
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.replace('Bearer ', '')
        try:
            payload = verify_jwt_token(token)
            if payload:
                user_id = payload['user_id']
                session_id = payload.get('session_id')
            else:
                return jsonify({"status": "invalid", "reason": "invalid_token"}), 401, response_headers
        except:
            return jsonify({"status": "invalid", "reason": "token_error"}), 401, response_headers
    else:
        # Если нет Bearer токена, используем заголовки X-User-Id и X-Session-Id
        user_id = request.headers.get('X-User-Id')
        session_id = request.headers.get('X-Session-Id')
    
    if not user_id or not session_id:
        return jsonify({"status": "invalid", "reason": "missing_credentials"}), 401, response_headers

    current_time = datetime.now()

    with get_db() as conn:
        cursor = conn.cursor(dictionary=True)
        cursor.execute('''
            SELECT c.*, 
                   TIMESTAMPDIFF(SECOND, NOW(), c.expires_at) as remaining_seconds
            FROM codes c
            WHERE c.user_id = %s 
            AND c.session_id = %s 
            AND c.is_used = TRUE 
            AND c.expires_at > NOW()
        ''', (user_id, session_id))
        code_data = cursor.fetchone()
        
        if code_data:
            remaining_seconds = int(code_data['remaining_seconds'])
            
            response_data = {
                "status": "active",
                "expires_at": str(code_data['expires_at']),
                "remaining_seconds": remaining_seconds,
                "check_time": current_time.strftime("%Y-%m-%d %H:%M:%S")
            }
            
            # Если осталось меньше 2 минут, отправляем предупреждение
            if remaining_seconds < 120:
                response_data["warning"] = "session_ending_soon"
            
            return jsonify(response_data), 200, response_headers
            
        # Если сессия истекла, очищаем её в базе
        cursor.execute('''
            UPDATE codes 
            SET is_used = FALSE, session_id = NULL 
            WHERE user_id = %s AND session_id = %s
        ''', (user_id, session_id))
        conn.commit()
    
    return jsonify({
        "status": "expired",
        "reason": "time_expired",
        "check_time": current_time.strftime("%Y-%m-%d %H:%M:%S")
    }), 401, response_headers

@app.route('/api/session_updated', methods=['POST'])
def session_updated():
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        session_id = data.get('session_id')
        
        if not user_id or not session_id:
            return jsonify({'error': 'Missing required fields'}), 400
            
        with get_db() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute('''
                SELECT needs_refresh, expires_at FROM codes 
                WHERE user_id = %s AND session_id = %s AND is_used = TRUE
            ''', (user_id, session_id))
            session = cursor.fetchone()
            
            if session and session['needs_refresh']:
                cursor.execute('''
                    UPDATE codes 
                    SET needs_refresh = FALSE 
                    WHERE user_id = %s AND session_id = %s
                ''', (user_id, session_id))
                conn.commit()
                
                return jsonify({
                    'status': 'updated',
                    'expires_at': str(session['expires_at'])
                })
        
        return jsonify({'status': 'no_update_needed'})
        
    except Exception as e:
        app.logger.error(f"Session update error: {str(e)}")
        return jsonify({'error': 'Server error'}), 500

@app.route('/dashboard')
def dashboard():
    try:
        # Добавляем заголовок для предотвращения кэширования страницы
        response_headers = {
            'Cache-Control': 'no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }

        # Добавляем защиту от циклических редиректов
        if request.args.get('no_redirect') == '1':
            return redirect(url_for('login_page'))

        # Проверяем сначала Bearer токен
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.replace('Bearer ', '')
            try:
                payload = verify_jwt_token(token)
                if payload:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute('''
                            SELECT 1 FROM codes 
                            WHERE user_id = %s AND session_id = %s AND is_used = 1 AND expires_at > %s
                        ''', (payload['user_id'], payload.get('session_id'), datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
                        session_active = cursor.fetchone()
                        
                        if session_active:
                            response = make_response(render_template('dashboard.html'))
                            for key, value in response_headers.items():
                                response.headers[key] = value
                            return response
            except Exception as e:
                app.logger.error(f"JWT or database error: {str(e)}")
                return jsonify({"error": "Ошибка проверки токена"}), 401

        # Проверяем обычную сессию
        if 'user_id' in session and session.get('session_id'):
            try:
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        SELECT 1 FROM codes 
                        WHERE user_id = %s AND session_id = %s AND is_used = 1 AND expires_at > %s
                    ''', (session['user_id'], session['session_id'], datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
                    session_active = cursor.fetchone()
                    
                    if session_active:
                        response = make_response(render_template('dashboard.html'))
                        for key, value in response_headers.items():
                            response.headers[key] = value
                        return response
            except Exception as e:
                app.logger.error(f"Session check error: {str(e)}")
                return jsonify({"error": "Ошибка проверки сессии"}), 500

        # Если нет активной сессии, перенаправляем на страницу входа
        return redirect(url_for('login_page', no_redirect='1'))

    except Exception as e:
        app.logger.error(f"Unexpected error in dashboard: {str(e)}")
        return jsonify({"error": "Критическая ошибка сервера"}), 500

    # Проверяем обычную сессию
    if 'user_id' in session and session.get('session_id'):
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT 1 FROM codes 
                WHERE user_id = %s AND session_id = %s AND is_used = 1 AND expires_at > %s
            ''', (session['user_id'], session['session_id'], datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
            session_active = cursor.fetchone()
            
            if session_active:
                response = make_response(render_template('dashboard.html'))
                for key, value in response_headers.items():
                    response.headers[key] = value
                return response

    # Добавляем параметр для предотвращения циклических редиректов
    return redirect(url_for('login_page', no_redirect='1'))

if __name__ == '__main__':
    # Инициализируем базу данных при первом запуске
    init_db()
    print("База данных инициализирована")
    
    # Получаем порт из переменных окружения или используем 5000 по умолчанию
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting server on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)