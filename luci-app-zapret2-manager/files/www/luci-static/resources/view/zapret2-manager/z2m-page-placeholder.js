'use strict';
'require baseclass';

function create(id, title, description) {
  return {
    id: id,
    title: title,
    contractRequired: true,
    load: function () { return Promise.resolve({}); },
    render: function () {
      return E('section', { 'class': 'z2m-page', 'data-page': id }, [
        E('h1', {}, title),
        E('div', { 'class': 'z2m-card' }, [
          E('div', { 'class': 'z2m-card__body' }, [
            E('span', { 'class': 'z2m-badge is-warn' }, _('REQUIRES BACKEND CONTRACT')),
            E('p', {}, description || _('Интерфейс спроектирован. Подключение появится после утверждения frontend-backend contract.'))
          ])
        ])
      ]);
    }
  };
}

return baseclass.extend({ create: create });
