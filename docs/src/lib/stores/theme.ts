import { browser } from '$app/environment';

// Dark mode only - initialize on page load
if (browser) {
  document.documentElement.classList.add('dark');
}
