import { mount } from 'svelte';
import '../ui/app.css';
import Home from './Home.svelte';

mount(Home, { target: document.getElementById('app')! });
