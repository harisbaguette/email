import { Component, type ReactNode } from 'react';
import { Brand } from './components';
import { Button, Notice } from './ui';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="session-recovery">
        <Brand />
        <h1>화면을 불러오지 못했습니다</h1>
        <Notice tone="error">연결을 확인한 뒤 다시 열어 주세요. 보관된 메일은 유지됩니다.</Notice>
        <Button variant="primary" onClick={() => location.reload()}>
          다시 열기
        </Button>
      </main>
    );
  }
}
