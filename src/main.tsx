import { render } from 'preact';
import css from './styles.css';
import { App } from './ui/app';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
render(<App />, document.getElementById('app')!);
