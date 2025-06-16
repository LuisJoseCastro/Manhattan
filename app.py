from flask import Flask, render_template, request, jsonify
import requests
from werkzeug.middleware.proxy_fix import ProxyFix
import logging
from flask_cors import CORS

# Configuración básica de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')

# Configuración CORS para desarrollo
CORS(app)

app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Configuración de headers para Nominatim
NOMINATIM_HEADERS = {
    'User-Agent': 'TuAppNavegacion/1.0 (contacto@tudominio.com)',
    'Accept-Language': 'es-MX,es'
}

@app.route('/nominatim-proxy')
def nominatim_proxy():
    try:
        query = request.args.get('q', '')
        if not query:
            app.logger.warning("Búsqueda vacía recibida")
            return jsonify({'error': 'Parámetro de búsqueda faltante'}), 400
            
        params = {
            'q': query,
            'format': 'json',
            'countrycodes': 'mx',
            'limit': 5,
            'accept-language': 'es-MX'
        }
        
        app.logger.info(f"Solicitando búsqueda para: {query}")
        
        response = requests.get(
            'https://nominatim.openstreetmap.org/search',
            params=params,
            headers=NOMINATIM_HEADERS,
            timeout=10,
            verify=True
        )
        
        response.raise_for_status()
        data = response.json()
        
        if not data:
            app.logger.warning(f"No se encontraron resultados para: {query}")
            return jsonify({'error': 'No se encontraron resultados'}), 404
            
        app.logger.info(f"Búsqueda exitosa, {len(data)} resultados")
        return jsonify(data)
        
    except requests.exceptions.Timeout:
        app.logger.error("Timeout al conectar con Nominatim")
        return jsonify({'error': 'El servicio de búsqueda no respondió a tiempo'}), 504
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Error de conexión con Nominatim: {str(e)}")
        return jsonify({'error': 'Error al conectar con el servicio de búsqueda'}), 502
    except Exception as e:
        app.logger.error(f"Error inesperado en Nominatim proxy: {str(e)}")
        return jsonify({'error': 'Error interno del servidor'}), 500

@app.route('/osrm-proxy')
def osrm_proxy():
    try:
        coords = request.args.get('coords')
        profile = request.args.get('profile', 'driving')
        avoid_tolls = request.args.get('avoid_tolls', 'false') == 'true'
        alternatives = request.args.get('alternatives', 'false') == 'true'
        
        if not coords:
            app.logger.error("Faltan coordenadas en la solicitud")
            return jsonify({'error': 'Coordenadas faltantes'}), 400
            
        # Validar formato de coordenadas
        try:
            coord_pairs = coords.split(';')
            for pair in coord_pairs:
                lon, lat = pair.split(',')
                float(lon), float(lat)
        except ValueError as e:
            app.logger.error(f"Coordenadas inválidas: {coords} - Error: {str(e)}")
            return jsonify({'error': 'Formato de coordenadas inválido'}), 400
        
        # Validar perfil de transporte
        valid_profiles = ['driving', 'walking', 'cycling', 'motorcycle']
        if profile not in valid_profiles:
            app.logger.error(f"Perfil de transporte inválido: {profile}")
            return jsonify({'error': 'Perfil de transporte inválido'}), 400
        
        # Construir URL base
        url = f'https://router.project-osrm.org/route/v1/{profile}/{coords}'
        
        # Parámetros básicos
        params = {
            'overview': 'full',
            'geometries': 'geojson',
            'steps': 'true',
            'annotations': 'true'
        }
        
        # Manejar parámetros adicionales
        if alternatives:
            params['alternatives'] = 'true'
        if avoid_tolls:
            params['exclude'] = 'toll'
        
        app.logger.info(f"Solicitando ruta a OSRM: {url} con parámetros: {params}")
        
        response = requests.get(
            url,
            params=params,
            headers={'User-Agent': 'TuAppNavegacion/1.0'},
            timeout=15,
            verify=True
        )
        
        response.raise_for_status()
        
        # Verificar si la respuesta contiene rutas válidas
        data = response.json()
        if data.get('code') != 'Ok':
            error_msg = data.get('message', 'Error desconocido de OSRM')
            app.logger.error(f"OSRM respondió con error: {error_msg}")
            return jsonify({'error': error_msg}), 500
            
        app.logger.info(f"Ruta calculada exitosamente, {len(data.get('routes', []))} rutas encontradas")
        return jsonify(data)
        
    except requests.exceptions.Timeout:
        app.logger.error("Timeout al conectar con OSRM")
        return jsonify({'error': 'El servicio de rutas no respondió a tiempo'}), 504
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Error de conexión con OSRM: {str(e)}")
        return jsonify({'error': 'Error al conectar con el servicio de rutas'}), 502
    except Exception as e:
        app.logger.error(f"Error inesperado en OSRM proxy: {str(e)}")
        return jsonify({'error': 'Error interno del servidor'}), 500

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True, port=5001, host='0.0.0.0')