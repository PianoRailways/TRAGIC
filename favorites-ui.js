function renderFavoritesBar() {
  var bar = document.getElementById('fav-bar');
  if (!bar) return;

  bar.innerHTML = '';

  var scrollContainer = document.createElement('div');
  scrollContainer.className = 'fav-scroll-container';

  var favoritesList = document.createElement('div');
  favoritesList.className = 'fav-list';

  favoriteStations.forEach(function (favorite) {
    var item = document.createElement('span');
    item.className = 'fav-item';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fav-btn';
    btn.textContent = getFavoriteLabel(favorite);
    btn.title = favorite.name;
    if (currentStopId && favorite.stopId === currentStopId) {
      btn.classList.add('is-current');
    }
    btn.addEventListener('click', function () {
      window.location = './?stopId=' + encodeURIComponent(favorite.stopId);
    });

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'fav-remove-btn';
    removeBtn.title = 'Favorit ' + getFavoriteLabel(favorite) + ' entfernen';
    removeBtn.setAttribute('aria-label', 'Favorit ' + getFavoriteLabel(favorite) + ' entfernen');
    removeBtn.textContent = '×';
    removeBtn.dataset.stopId = favorite.stopId;
    removeBtn.dataset.confirmPending = 'false';

    removeBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      var isConfirmPending = removeBtn.dataset.confirmPending === 'true';

      if (!isConfirmPending) {
        removeBtn.dataset.confirmPending = 'true';
        removeBtn.textContent = '✓ Löschen?';
        removeBtn.classList.add('fav-remove-btn-confirm');

        setTimeout(function () {
          if (removeBtn.dataset.confirmPending === 'true') {
            removeBtn.dataset.confirmPending = 'false';
            removeBtn.textContent = '×';
            removeBtn.classList.remove('fav-remove-btn-confirm');
          }
        }, 3000);
      } else {
        favoriteStations = favoriteStations.filter(function (entry) {
          return entry.stopId !== favorite.stopId;
        });
        saveFavoritesToStorage();
        renderFavoritesBar();
      }
    });

    item.appendChild(btn);
    item.appendChild(removeBtn);
    favoritesList.appendChild(item);
  });

  scrollContainer.appendChild(favoritesList);
  bar.appendChild(scrollContainer);

  var controls = document.createElement('div');
  controls.className = 'fav-controls';

  var starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = 'fav-star-btn';
  var canFavorite = !!currentStopId && !!currentStationName && currentStationName !== 'Station wählen';
  var activeFavorite = canFavorite && isFavoriteStation(currentStopId);
  starBtn.textContent = activeFavorite ? '★' : '☆';
  starBtn.title = canFavorite ? (activeFavorite ? 'Aktuelle Station aus Favoriten entfernen' : 'Aktuelle Station zu Favoriten hinzufügen') : 'Station auswählen, um Favorit zu speichern';
  starBtn.disabled = !canFavorite;
  if (activeFavorite) {
    starBtn.classList.add('is-active');
  }
  starBtn.addEventListener('click', function () {
    if (!canFavorite) return;

    if (activeFavorite) {
      favoriteStations = favoriteStations.filter(function (entry) { return entry.stopId !== currentStopId; });
    } else {
      if (isFavoriteStation(currentStopId)) {
        renderFavoritesBar();
        return;
      }

      favoriteStations = favoriteStations.concat({
        stopId: currentStopId,
        name: currentStationName,
        label: getFavoriteLabelForName(currentStationName)
      });
    }

    saveFavoritesToStorage();
    renderFavoritesBar();
  });

  var resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'fav-reset-btn';
  resetBtn.title = 'Favoriten auf die eingebauten Standards zurücksetzen';
  resetBtn.textContent = 'Standard';
  resetBtn.dataset.confirmPending = 'false';
  resetBtn.addEventListener('click', function () {
    var isConfirmPending = resetBtn.dataset.confirmPending === 'true';

    if (!isConfirmPending) {
      resetBtn.dataset.confirmPending = 'true';
      resetBtn.textContent = '✓ Löschen?';
      resetBtn.classList.add('fav-remove-btn-confirm');

      setTimeout(function () {
        if (resetBtn.dataset.confirmPending === 'true') {
          resetBtn.dataset.confirmPending = 'false';
          resetBtn.textContent = 'Standard';
          resetBtn.classList.remove('fav-remove-btn-confirm');
        }
      }, 3000);
      return;
    }

    favoriteStations = cloneDefaultFavorites();
    localStorage.removeItem(FAVORITES_STORAGE_KEY);
    renderFavoritesBar();
  });

  controls.appendChild(starBtn);
  controls.appendChild(resetBtn);
  bar.appendChild(controls);
}

function renderStationsView() {
  var stationsView = document.getElementById('stations-view');
  var stationsList = document.getElementById('stations-list');

  if (!stationsView || !stationsList) return;

  stationsList.innerHTML = '';

  DEFAULT_FAVORITES.forEach(function (station) {
    var li = document.createElement('li');

    var link = document.createElement('a');
    link.className = 'stations-item';
    link.textContent = station.name;
    link.href = 'javascript:void(0);';

    link.addEventListener('click', function (e) {
      e.preventDefault();
      selectStation(station.stopId, station.name, null);
      closeStationsView();
    });

    li.appendChild(link);
    stationsList.appendChild(li);
  });

  stationsView.style.display = 'flex';
}

function closeStationsView() {
  var stationsView = document.getElementById('stations-view');
  if (stationsView) {
    stationsView.style.display = 'none';
  }
}

function renderFavoritesView() {
  var favoritesView = document.getElementById('favorites-view');
  var favoritesList = document.getElementById('favorites-list');

  if (!favoritesView || !favoritesList) return;

  favoritesList.innerHTML = '';

  favoriteStations.forEach(function (favorite) {
    var li = document.createElement('li');

    var itemContainer = document.createElement('div');
    itemContainer.style.display = 'flex';
    itemContainer.style.flex = '1';
    itemContainer.style.alignItems = 'center';
    itemContainer.style.justifyContent = 'space-between';

    var link = document.createElement('a');
    link.className = 'stations-item';
    link.textContent = favorite.name;
    link.href = 'javascript:void(0);';
    link.style.flex = '1';

    link.addEventListener('click', function (e) {
      e.preventDefault();
      selectStation(favorite.stopId, favorite.name, null);
      closeFavoritesView();
    });

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'fav-remove-btn';
    deleteBtn.title = 'Favorit ' + favorite.name + ' löschen';
    deleteBtn.textContent = '×';
    deleteBtn.style.marginRight = '10px';
    deleteBtn.dataset.stopId = favorite.stopId;
    deleteBtn.dataset.confirmPending = 'false';

    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isConfirmPending = deleteBtn.dataset.confirmPending === 'true';

      if (!isConfirmPending) {
        deleteBtn.dataset.confirmPending = 'true';
        deleteBtn.textContent = '✓ Löschen?';
        deleteBtn.classList.add('fav-remove-btn-confirm');

        setTimeout(function () {
          if (deleteBtn.dataset.confirmPending === 'true') {
            deleteBtn.dataset.confirmPending = 'false';
            deleteBtn.textContent = '×';
            deleteBtn.classList.remove('fav-remove-btn-confirm');
          }
        }, 3000);
      } else {
        favoriteStations = favoriteStations.filter(function (entry) {
          return entry.stopId !== favorite.stopId;
        });
        saveFavoritesToStorage();
        renderFavoritesView();
        renderFavoritesBar();
      }
    });

    itemContainer.appendChild(link);
    itemContainer.appendChild(deleteBtn);
    li.appendChild(itemContainer);
    favoritesList.appendChild(li);
  });

  favoritesView.style.display = 'flex';
}

function closeFavoritesView() {
  var favoritesView = document.getElementById('favorites-view');
  if (favoritesView) {
    favoritesView.style.display = 'none';
  }
}

function renderHomeView() {
  var homeView = document.getElementById('home-view');
  if (homeView) {
    homeView.style.display = 'flex';
  }
}

function closeHomeView() {
  var homeView = document.getElementById('home-view');
  if (homeView) {
    homeView.style.display = 'none';
  }
}

function checkAndRenderView() {
  var viewParam = params.get('view');

  if (viewParam === 'home') {
    renderHomeView();
  } else if (viewParam === 'stations') {
    closeHomeView();
    renderStationsView();
  } else if (viewParam === 'favorites') {
    closeHomeView();
    renderFavoritesView();
  }
}

function toggleMenu() {
  var sidebar = document.getElementById('menu-sidebar');
  var overlay = document.getElementById('menu-overlay');

  if (!sidebar || !overlay) return;

  sidebar.classList.toggle('active');
  overlay.classList.toggle('active');
  document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : '';
}

function closeMenu() {
  var sidebar = document.getElementById('menu-sidebar');
  var overlay = document.getElementById('menu-overlay');

  if (!sidebar || !overlay) return;

  sidebar.classList.remove('active');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

window.renderFavoritesBar = renderFavoritesBar;
window.renderStationsView = renderStationsView;
window.closeStationsView = closeStationsView;
window.renderFavoritesView = renderFavoritesView;
window.closeFavoritesView = closeFavoritesView;
window.renderHomeView = renderHomeView;
window.closeHomeView = closeHomeView;
window.checkAndRenderView = checkAndRenderView;
window.toggleMenu = toggleMenu;
window.closeMenu = closeMenu;
