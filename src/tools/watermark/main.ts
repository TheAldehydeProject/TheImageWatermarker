import { mount } from 'svelte';
import '../../ui/app.css';
import WatermarkPage from './WatermarkPage.svelte';

mount(WatermarkPage, { target: document.getElementById('app')! });
