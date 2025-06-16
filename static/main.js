// Configuración inicial del mapa
const map = L.map('map').setView([19.8253, -99.7857], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '©️ OpenStreetMap'
}).addTo(map);

// Variables de estado
const state = {
  markers: {
    start: null,
    end: null,
    current: null,
    simulation: null
  },
  routes: {
    main: null,
    manhattan: null,
    alternatives: []
  },
  navigation: {
    steps: [],
    currentStep: 0,
    simulationInterval: null,
    startTime: null,
    estimatedDuration: 0
  },
  search: {
    timeout: null,
    results: []
  },
  selectionStep: 0
};

// Velocidades promedio según tipo de transporte (km/h)
const VELOCIDADES = {
  driving: 50,
  walking: 5,
  cycling: 15,
  motorcycle: 60
};

// Referencias a elementos del DOM
const info = document.getElementById('info');
const resetBtn = document.getElementById('resetBtn');
const buscarBtn = document.getElementById('buscarBtn');
const buscadorInput = document.getElementById('buscador');
const instruccionesContainer = document.getElementById('instrucciones-container');
const instruccionesList = document.getElementById('instrucciones');
const tiempoEstimadoDisplay = document.getElementById('tiempoEstimado');

// Configuración de endpoints públicos
const API_ENDPOINTS = {
  nominatim: 'https://nominatim.openstreetmap.org/search',
  osrm: 'https://router.project-osrm.org/route/v1/driving'
};

// --- FUNCIONES PRINCIPALES ---

function reset() {
  clearInterval(state.navigation.simulationInterval);
  
  Object.values(state.markers).forEach(marker => {
    if (marker) map.removeLayer(marker);
  });
  
  if (state.routes.main) map.removeLayer(state.routes.main);
  if (state.routes.manhattan) map.removeLayer(state.routes.manhattan);
  state.routes.alternatives.forEach(route => map.removeLayer(route));

  state.markers = {
    start: null,
    end: null,
    current: null,
    simulation: null
  };
  state.routes = {
    main: null,
    manhattan: null,
    alternatives: []
  };
  state.navigation = {
    steps: [],
    currentStep: 0,
    simulationInterval: null,
    startTime: null,
    estimatedDuration: 0
  };
  state.search.results = [];
  state.selectionStep = 0;
  
  document.getElementById('coordenadasInicio').value = '';
  document.getElementById('coordenadasDestino').value = '';
  
  instruccionesContainer.style.display = 'none';
  instruccionesList.innerHTML = '';
  if (tiempoEstimadoDisplay) tiempoEstimadoDisplay.textContent = '';
  updateInfo("Haz clic en el mapa para seleccionar inicio y destino.");
}

function updateInfo(message, isError = false) {
  info.textContent = message;
  info.style.color = isError ? '#EA4335' : '#333';
}

function onMapClick(e) {
  if (state.selectionStep === 0) {
    if (state.markers.start) map.removeLayer(state.markers.start);
    state.markers.start = L.marker(e.latlng).addTo(map).bindPopup("Inicio").openPopup();
    document.getElementById("coordenadasInicio").value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    state.selectionStep = 1;
    updateInfo("Excelente. Ahora selecciona el destino.");
  } else if (state.selectionStep === 1) {
    if (state.markers.end) map.removeLayer(state.markers.end);
    state.markers.end = L.marker(e.latlng).addTo(map).bindPopup("Destino").openPopup();
    document.getElementById("coordenadasDestino").value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    state.selectionStep = 2;
    updateInfo("Calculando ruta...");
    calcularRutaOSRM(state.markers.start.getLatLng(), state.markers.end.getLatLng());
  }
}

function validarCoordenadas(coordenadas) {
  if (!coordenadas) return false;
  
  const partes = coordenadas.split(',');
  if (partes.length !== 2) return false;
  
  const lat = parseFloat(partes[0].trim());
  const lng = parseFloat(partes[1].trim());
  
  return !isNaN(lat) && !isNaN(lng) && 
         lat >= -90 && lat <= 90 && 
         lng >= -180 && lng <= 180;
}

async function buscarLugar() {
  const lugar = buscadorInput.value.trim();
  if (!lugar) {
    updateInfo("Por favor ingresa un lugar.", true);
    return;
  }

  buscarBtn.innerHTML = `<span class="loading-spinner"></span> Buscando...`;
  buscarBtn.disabled = true;
  updateInfo(`Buscando "${lugar}"...`);
  
  try {
    const url = `${API_ENDPOINTS.nominatim}?format=json&q=${encodeURIComponent(lugar)}&limit=5`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GPS-MEX/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data || data.length === 0) {
      updateInfo(`No se encontró "${lugar}". Intenta con términos más específicos.`, true);
      return;
    }

    state.search.results = data;
    
    if (data.length === 1) {
      mostrarResultadoUnico(data[0]);
    } else {
      mostrarMultiplesResultados(data);
    }
  } catch (err) {
    console.error("Error en búsqueda:", err);
    updateInfo("Error al buscar. Intenta nuevamente más tarde.", true);
  } finally {
    buscarBtn.textContent = "Buscar";
    buscarBtn.disabled = false;
  }
}

function mostrarResultadoUnico(resultado) {
  const lat = parseFloat(resultado.lat);
  const lon = parseFloat(resultado.lon);
  
  if (state.markers.current) map.removeLayer(state.markers.current);

  map.setView([lat, lon], 14);
  
  state.markers.current = L.marker([lat, lon])
    .addTo(map)
    .bindPopup(`
      <b>${resultado.display_name || 'Ubicación encontrada'}</b><br>
      <small>Coordenadas: ${lat.toFixed(6)}, ${lon.toFixed(6)}</small>
    `)
    .openPopup();

  updateInfo(`Resultado: ${resultado.display_name || 'Ubicación encontrada'}`);
  
  if (state.selectionStep === 0) {
    document.getElementById("coordenadasInicio").value = `${lat}, ${lon}`;
  } else if (state.selectionStep === 1) {
    document.getElementById("coordenadasDestino").value = `${lat}, ${lon}`;
  }
}

function mostrarMultiplesResultados(data) {
  const primerResultado = data[0];
  const lat = parseFloat(primerResultado.lat);
  const lon = parseFloat(primerResultado.lon);
  
  let html = `<b>Se encontraron ${data.length} resultados:</b><br><div style="max-height: 200px; overflow-y: auto;">`;
  
  data.slice(0, 5).forEach((item, index) => {
    const nombreCorto = item.display_name.split(',')[0];
    const ubicacion = item.display_name.split(',').slice(1, 3).join(',');
    html += `
      <div style="padding: 8px; border-bottom: 1px solid #eee; cursor: pointer;" 
           onclick="seleccionarResultado(${index})">
        <b>${nombreCorto}</b><br>
        <small>${ubicacion}</small>
      </div>
    `;
  });
  
  html += `</div><small>Haz clic en un resultado para seleccionarlo</small>`;
  
  map.setView([lat, lon], 10);
  
  L.popup()
    .setLatLng([lat, lon])
    .setContent(html)
    .openOn(map);
  
  updateInfo(`Se encontraron ${data.length} resultados. Selecciona uno.`);
}

function generarInstruccionDesdeManiobra(maneuver) {
  const tipos = {
    'turn': 'Girar',
    'new name': 'Continuar en',
    'depart': 'Iniciar en',
    'arrive': 'Llegar a',
    'merge': 'Incorporarse a',
    'ramp': 'Tomar rampa hacia',
    'on ramp': 'Entrar en rampa hacia',
    'off ramp': 'Salir por rampa hacia',
    'fork': 'En bifurcación, tomar',
    'end of road': 'Fin de camino,',
    'use lane': 'Usar carril para',
    'continue': 'Continuar',
    'roundabout': 'Entrar en rotonda',
    'rotary': 'Entrar en rotonda',
    'roundabout turn': 'En rotonda, tomar',
    'notification': 'Notificación:'
  };
  
  const modificadores = {
    'uturn': 'media vuelta',
    'sharp right': 'giro cerrado a la derecha',
    'right': 'derecha',
    'slight right': 'ligero giro a la derecha',
    'straight': 'recto',
    'slight left': 'ligero giro a la izquierda',
    'left': 'izquierda',
    'sharp left': 'giro cerrado a la izquierda'
  };
  
  const tipo = tipos[maneuver.type] || 'Maniobra';
  const modificador = modificadores[maneuver.modifier] || '';
  
  return `${tipo} ${modificador}`.trim();
}

function procesarInstrucciones(data) {
  instruccionesList.innerHTML = '';
  state.navigation.steps = [];
  
  if (!data.routes || data.routes.length === 0 || !data.routes[0].legs || data.routes[0].legs.length === 0) {
    instruccionesList.innerHTML = '<li>No hay instrucciones disponibles para esta ruta</li>';
    return;
  }
  
  data.routes[0].legs[0].steps.forEach((step, index) => {
    let instruccion = "Continuar recto";
    
    if (step.maneuver) {
      if (step.maneuver.instruction) {
        instruccion = step.maneuver.instruction
          .replace(/<[^>]*>/g, '')
          .replace(/^Diríjase /, '')
          .replace(/^Continúe /, 'Continuar ');
      } else if (step.maneuver.type && step.maneuver.modifier) {
        instruccion = generarInstruccionDesdeManiobra(step.maneuver);
      }
    }
    
    const distancia = step.distance > 1000 ? 
      `${(step.distance/1000).toFixed(1)} km` : 
      `${Math.round(step.distance)} m`;
    
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="instruccion-icono">${index+1}</span>
      <span class="instruccion-texto">${instruccion}</span>
      <span class="instruccion-distancia">${distancia}</span>
    `;
    
    state.navigation.steps.push({
      instruccion: instruccion,
      distancia: step.distance,
      coordenadas: step.maneuver?.location || step.geometry?.coordinates?.[0] || null
    });
    
    instruccionesList.appendChild(li);
  });
  
  if (state.navigation.steps.length > 0) {
    mostrarInstruccion(0);
  }
}

function mostrarInstruccion(index) {
  const items = instruccionesList.querySelectorAll('li');
  items.forEach((item, i) => {
    item.classList.toggle('instruccion-activa', i === index);
  });
  
  if (state.navigation.steps[index]?.coordenadas) {
    const coords = state.navigation.steps[index].coordenadas;
    map.setView([coords[1], coords[0]], 16, { animate: true });
  }
}

async function calcularRutaOSRM(inicio, destino) {
  const tipoTransporte = document.getElementById('tipoTransporte').value;
  const evitarPeajes = document.getElementById('evitarPeajes').checked;
  const alternativas = document.getElementById('mostrarAlternativas').checked;
  
  const coords = `${inicio.lng},${inicio.lat};${destino.lng},${destino.lat}`;
  
  const calcularBtn = document.getElementById('calcularBtn');
  const originalText = calcularBtn.textContent;
  calcularBtn.innerHTML = `<span class="loading-spinner"></span> Calculando...`;
  calcularBtn.disabled = true;
  
  updateInfo("Calculando ruta...");
  
  try {
    let url = `${API_ENDPOINTS.osrm}/${coords}?overview=full&steps=true&geometries=geojson`;
    
    if (alternativas) {
      url += '&alternatives=true';
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.code !== 'Ok') {
      throw new Error(data.message || "Error en el servicio de rutas");
    }
    
    if (evitarPeajes) {
      updateInfo("Advertencia: El servicio público no soporta evitar peajes. Mostrando todas las rutas.", false);
    }
    
    if (alternativas && data.routes && data.routes.length > 1) {
      mostrarRutasAlternativas(data.routes);
    } else if (data.routes && data.routes.length > 0) {
      procesarRutaPrincipal(data.routes[0], tipoTransporte);
    } else {
      throw new Error("No se encontraron rutas con los parámetros seleccionados");
    }
  } catch (err) {
    console.error("Error al calcular ruta:", err);
    updateInfo(`Error: ${err.message}. Intenta nuevamente.`, true);
  } finally {
    calcularBtn.textContent = originalText;
    calcularBtn.disabled = false;
  }
}

function procesarRutaPrincipal(ruta, tipoTransporte) {
  if (state.routes.main) map.removeLayer(state.routes.main);
  
  try {
    const geoJsonRuta = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: ruta.geometry.coordinates
      }
    };

    state.routes.main = L.geoJSON(geoJsonRuta, {
      style: { color: '#4285F4', weight: 5 }
    }).addTo(map);
    
    map.fitBounds(state.routes.main.getBounds());
    
    procesarInstrucciones({routes: [ruta]});
    mostrarInstruccion(0);
    instruccionesContainer.style.display = 'block';
    
    const distancia = (ruta.distance / 1000).toFixed(1);
    const duracion = calcularTiempoEstimado(ruta.distance, tipoTransporte);
    state.navigation.estimatedDuration = duracion;
    
    updateInfo(`Ruta: ${distancia} km`);
    if (tiempoEstimadoDisplay) {
      tiempoEstimadoDisplay.textContent = `Tiempo estimado: ${formatearTiempo(duracion)}`;
    }

    iniciarSimulacionDeRuta(geoJsonRuta.geometry.coordinates, tipoTransporte);
  } catch (err) {
    console.error("Error al procesar ruta:", err);
    updateInfo("Error al mostrar la ruta. Formato de datos inválido.", true);
  }
}

function calcularTiempoEstimado(distanciaMetros, tipoTransporte) {
  const distanciaKm = distanciaMetros / 1000;
  const velocidad = VELOCIDADES[tipoTransporte] || 30;
  return (distanciaKm / velocidad) * 60;
}

function formatearTiempo(minutos) {
  const horas = Math.floor(minutos / 60);
  const mins = Math.round(minutos % 60);
  if (horas > 0) {
    return `${horas}h ${mins}min`;
  }
  return `${mins} minutos`;
}

function mostrarRutasAlternativas(rutas) {
  if (state.routes.main) map.removeLayer(state.routes.main);
  
  const contenedor = document.createElement('div');
  contenedor.innerHTML = '<h4>Selecciona una ruta:</h4>';
  
  state.routes.alternatives = rutas.map((ruta, i) => {
    const color = i === 0 ? '#4285F4' : ['#EA4335', '#FBBC05', '#34A853'][i % 3];
    
    const geoJsonRuta = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: ruta.geometry.coordinates
      }
    };
    
    const rutaLayer = L.geoJSON(geoJsonRuta, {
      style: { color, weight: 5, opacity: 0.7 }
    }).addTo(map);
    
    const btn = document.createElement('button');
    const tipoTransporte = document.getElementById('tipoTransporte').value;
    const duracion = calcularTiempoEstimado(ruta.distance, tipoTransporte);
    
    btn.textContent = `Opción ${i+1}: ${(ruta.distance/1000).toFixed(1)} km, ${formatearTiempo(duracion)}`;
    btn.style.margin = '5px';
    btn.style.padding = '8px';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    btn.style.cursor = 'pointer';
    
    btn.onclick = () => {
      state.routes.alternatives.forEach(alt => map.removeLayer(alt));
      state.routes.alternatives = [];
      procesarRutaPrincipal(ruta, tipoTransporte);
      map.closePopup();
    };
    
    contenedor.appendChild(btn);
    
    return rutaLayer;
  });
  
  L.popup()
    .setLatLng(state.markers.start.getLatLng())
    .setContent(contenedor)
    .openOn(map);
}

function iniciarSimulacionDeRuta(coordenadasRuta, tipoTransporte) {
  const DISTANCIA_CORTE_MANHATTAN = 500;
  const velocidad = VELOCIDADES[tipoTransporte] || 30;
  const factorVelocidad = 50 / velocidad;
  
  let indicePuntoActual = 0;
  let distanciaInstruccion = 0;
  let pasoInstruccion = 0;
  
  const distanciaTotal = coordenadasRuta.reduce((total, punto, i) => {
    if (i === 0) return 0;
    const prev = coordenadasRuta[i-1];
    return total + L.latLng(punto[1], punto[0]).distanceTo(L.latLng(prev[1], prev[0]));
  }, 0);
  
  const tiempoTotal = calcularTiempoEstimado(distanciaTotal, tipoTransporte);
  state.navigation.estimatedDuration = tiempoTotal;
  state.navigation.startTime = new Date();
  
  const primerPunto = L.latLng(coordenadasRuta[0][1], coordenadasRuta[0][0]);
  if (state.markers.simulation) map.removeLayer(state.markers.simulation);
  
  state.markers.simulation = L.marker(primerPunto, {
    icon: L.icon({
      iconUrl: 'https://cdn-icons-png.flaticon.com/512/535/535137.png',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    })
  }).addTo(map);

  if (state.navigation.simulationInterval) clearInterval(state.navigation.simulationInterval);

  function actualizarTiempoRestante() {
    if (tiempoEstimadoDisplay) {
      const tiempoTranscurrido = (new Date() - state.navigation.startTime) / 60000;
      const tiempoRestante = Math.max(0, state.navigation.estimatedDuration - tiempoTranscurrido);
      tiempoEstimadoDisplay.textContent = `Tiempo restante: ${formatearTiempo(tiempoRestante)}`;
    }
  }

  state.navigation.simulationInterval = setInterval(() => {
    if (indicePuntoActual >= coordenadasRuta.length) {
      clearInterval(state.navigation.simulationInterval);
      updateInfo("¡Has llegado a tu destino!");
      mostrarInstruccion(state.navigation.steps.length - 1);
      if (tiempoEstimadoDisplay) tiempoEstimadoDisplay.textContent = "¡Has llegado!";
      return;
    }

    const puntoActualCoords = coordenadasRuta[indicePuntoActual];
    const posActual = L.latLng(puntoActualCoords[1], puntoActualCoords[0]);
    state.markers.simulation.setLatLng(posActual);

    if (pasoInstruccion < state.navigation.steps.length - 1) {
      distanciaInstruccion += indicePuntoActual > 0 ? 
        posActual.distanceTo(L.latLng(coordenadasRuta[indicePuntoActual-1][1], coordenadasRuta[indicePuntoActual-1][0])) : 0;
      
      if (distanciaInstruccion >= state.navigation.steps[pasoInstruccion].distancia * 0.9) {
        pasoInstruccion++;
        mostrarInstruccion(pasoInstruccion);
        distanciaInstruccion = 0;
      }
    }

    const distRealAlDestino = posActual.distanceTo(state.markers.end.getLatLng());
    const progreso = ((indicePuntoActual / coordenadasRuta.length) * 100).toFixed(1);

    if (distRealAlDestino > DISTANCIA_CORTE_MANHATTAN) {
      if (state.routes.manhattan) {
        map.removeLayer(state.routes.manhattan);
        state.routes.manhattan = null;
      }
      updateInfo(`Progreso: ${progreso}% | Distancia restante: ${(distRealAlDestino/1000).toFixed(1)} km`);
    } else {
      const puntosManhattan = trazarRutaManhattan(posActual, state.markers.end.getLatLng());
      if (state.routes.manhattan) {
        state.routes.manhattan.setLatLngs(puntosManhattan);
      } else {
        state.routes.manhattan = L.polyline(puntosManhattan, { 
          color: '#EA4335', 
          weight: 6, 
          dashArray: '10, 5' 
        }).addTo(map);
      }
      updateInfo(`¡Estás cerca! (${progreso}%) | Faltan ${distRealAlDestino.toFixed(0)} metros`);
    }

    actualizarTiempoRestante();
    indicePuntoActual++;
  }, 100 * factorVelocidad);
}

function trazarRutaManhattan(inicio, destino) {
  return [
    inicio,
    [inicio.lat, destino.lng],
    destino
  ];
}

// Event listeners
resetBtn.addEventListener('click', reset);

buscarBtn.addEventListener('click', function(e) {
  e.preventDefault();
  buscarLugar();
});

buscadorInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    buscarLugar();
  }
});

document.getElementById('calcularBtn').addEventListener('click', function() {
  // Obtener las coordenadas de inicio y destino
  const coordsInicio = document.getElementById("coordenadasInicio").value.trim();
  const coordsDestino = document.getElementById("coordenadasDestino").value.trim();
  
  // Validar formato de coordenadas
  const inicioValido = validarCoordenadas(coordsInicio);
  const destinoValido = validarCoordenadas(coordsDestino);
  
  if (!inicioValido || !destinoValido) {
    updateInfo("Por favor ingresa coordenadas válidas en formato: latitud, longitud", true);
    return;
  }
  
  // Extraer latitud y longitud
  const [latInicio, lngInicio] = coordsInicio.split(',').map(Number);
  const [latDestino, lngDestino] = coordsDestino.split(',').map(Number);
  
  // Limpiar marcadores anteriores
  if (state.markers.start) map.removeLayer(state.markers.start);
  if (state.markers.end) map.removeLayer(state.markers.end);
  
  // Crear nuevos marcadores
  state.markers.start = L.marker([latInicio, lngInicio]).addTo(map).bindPopup("Inicio").openPopup();
  state.markers.end = L.marker([latDestino, lngDestino]).addTo(map).bindPopup("Destino").openPopup();
  
  // Calcular ruta
  state.selectionStep = 2;
  updateInfo("Calculando ruta desde coordenadas ingresadas...");
  calcularRutaOSRM(state.markers.start.getLatLng(), state.markers.end.getLatLng());
});

window.seleccionarResultado = function(index) {
  if (state.search.results[index]) {
    mostrarResultadoUnico(state.search.results[index]);
  }
};

window.cambiarTransporte = function(modo, event) {
  document.getElementById('tipoTransporte').value = modo;
  
  document.querySelectorAll('#modo-movilidad button').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  if (state.markers.start && state.markers.end) {
    calcularRutaOSRM(state.markers.start.getLatLng(), state.markers.end.getLatLng());
  }
};

// Inicialización
map.on('click', onMapClick);
reset();