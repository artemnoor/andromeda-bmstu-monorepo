# Аналитика Rybbit

Бесплатная самостоятельная установка Rybbit v2.9.0 работает на текущей ВМ. Подписка и внешние API-ключи не используются. Панель: https://analytics.185.135.175.229.sslip.io. Данные сайта закрыты авторизацией; регистрация новых пользователей отключена.

## Подключение сайта

В `.env.production.local` задан `VITE_ANALYTICS_SITE_ID` — публичный числовой идентификатор сайта из собственной панели. Это не секрет и не API-ключ. При его отсутствии отправка выключена. Изменение требует пересборки клиента. Локальная разработка исключена, если явно не включить `VITE_ANALYTICS_DEBUG=true`.

Сайт отправляет небольшие JSON-запросы на свой `/insights/track`. Nginx направляет их на Rybbit `/api/track`. Отдельный SDK Rybbit не загружается. Для Core Web Vitals лениво загружается `web-vitals`. Ошибки аналитики не мешают сайту. SPA-переходы дают один pageview на изменение пути; изменение поиска и фильтров не раздувает счётчик просмотров.

С 25.10.2026 в `anonymous_id` передаётся случайный ID браузера из localStorage (`andromeda.analytics.visitor.v1`). В Rybbit отключено ежедневное salting. Возвращаемость и удержание сохраняются при смене VPN/IP в одном браузере; другой браузер, инкогнито или очистка данных создают другой ID. Старые ID задним числом не объединяются. IP по-прежнему не хранится. Опт-аут: `localStorage.setItem("andromeda.analytics.disabled", "true")`.

В querystring сохраняется только allowlist `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`. Параметры `result`, `program`, поисковый запрос и ответы не отправляются. Все события имеют `page_type`; контекст общей ссылки сохраняется в свойствах pageview.

## События

| Событие | Значение |
| --- | --- |
| pageview | Просмотр страницы, нативный тип Rybbit |
| catalog_results_viewed | Число результатов, наличие/длина поиска и наличие фильтров; задержка 600 мс |
| comparison_program_added / comparison_program_removed | Ключ программы и размер сравнения после успешного изменения |
| prof_test_started | Отправлен первый этап |
| prof_test_step_viewed | Название этапа и число завершённых парных сравнений |
| prof_test_completed | Пользователь дошёл до результата в интерактивном прохождении |
| prof_test_result_viewed | Источник результата: тест, сохранённая сессия, ссылка |
| prof_test_restarted | Пользователь начинает заново |
| share_link_created | Тип отчёта и успешность копирования; сама ссылка не отправляется |
| pdf_download_requested | Запрос PDF |
| pdf_download_initiated | Файл передан браузеру; это не подтверждение сохранения на диск |
| pdf_download_failed | Не удалось создать/передать PDF; текст ошибки не отправляется |
| comparison_search_used / comparison_search_selected | Поиск и добавление из поиска; только длина запроса и количество результатов |
| comparison_limit_reached | Попытка добавить четвёртую программу |
| comparison_load_failed / comparison_search_load_failed | Ошибка загрузки сравнения или каталога поиска без текста ответа API |
| favorite_program_added / favorite_program_removed | Сохранение и удаление программы из избранного |
| program_card_opened / navigation_clicked | Переход к программе или в раздел; только путь без параметров |
| page_engaged | Страница была видима не менее 15 секунд |
| page_engagement | Время видимого просмотра при уходе/скрытии вкладки; фон не учитывается |
| scroll_depth | Первое достижение 25/50/75/90% прокрутки страницы |
| page_not_found | Посещение страницы 404 |

В нативные таблицы Rybbit также поступают `outbound`, `error` и `performance`.
Ошибки дедуплицируются, произвольные сообщения/stack не передаются. Web Vitals
отправляются один раз на документ через 20 секунд или при уходе, тайминги в
миллисекундах, CLS безразмерный. Это измерения реальных посещений, не Lighthouse.

Изменение выбора через поиск/удаление в сравнении теперь учитывается так же,
как кнопки каталога. Синхронизация сохранённого выбора из общей ссылки не
создаёт фиктивных событий добавления.

## Готовые отчёты

Созданы 8 целей (начало/завершение профтеста, просмотр программы, добавление в
сравнение, избранное, успешное копирование ссылки, передача PDF браузеру,
вовлечённый просмотр) и 3 воронки (профтест, каталог → сравнение, поиск в сравнении
→ PDF). Используют существующие события, поэтому часть целей уже видит историю;
новые события доступны только после выпуска новой версии клиента.

Панели защищены прежним входом: `/1/goals`, `/1/funnels`, `/1/users`, `/1/retention`,
`/1/errors`. Пустой блок Referrers означает отсутствие записанного внешнего
реферера за период, а не отсутствие всех посещений. Прямые переходы видны в
Channels; метки кампаний — в UTM. Для проверки использован отчёт Today с часовым
поясом Europe/Moscow: 25 октября около 00:10 были 2 посетителя и 5 просмотров.

Размеченные ссылки для публикаций:

- Telegram: `https://andromedabmstu.ru/?utm_source=telegram&utm_medium=social&utm_campaign=launch`
- VK: `https://andromedabmstu.ru/?utm_source=vk&utm_medium=social&utm_campaign=launch`

Общие свойства пользовательских событий: `app=andromeda`, `path`.

## Данные

Не передаются баллы абитуриента, ответы профтеста, текст поиска и произвольные параметры URL. Referrer очищается от query и hash. Cookies и identify не используются; применяется анонимный ID localStorage. Включена серверная фильтрация ботов. IP не сохраняется в настройках сайта. Панель поддерживает воронки, цели, пути и удержание. Запись сессий и автосбор содержимого форм выключены.

## Сервер

Каталог `/opt/andromeda-analytics`: `compose.yml`, `compose.override.yml`, `.env` (600) и `admin.json` (600). Последний содержит доступ владельца; в репозиторий не включается. Compose project `andromeda-analytics`, контейнеры имеют префикс `andromeda-analytics-`. Базы аналитики отделены от PostgreSQL приложения. Порты контейнеров опубликованы только на loopback: 13101, 13102, 15432, 18123, 16379. Настроены ограничения CPU/RAM и тома данных. Телеметрия самой установки выключена.

```sh
sudo docker compose -p andromeda-analytics --project-directory /opt/andromeda-analytics ps
sudo docker compose -p andromeda-analytics --project-directory /opt/andromeda-analytics logs --tail 50 backend
```

Nginx: `/etc/nginx/sites-available/andromeda-analytics`, `/etc/nginx/conf.d/andromeda-analytics.conf` и collector location в существующем `andromeda-preview`. TLS-сертификат Let's Encrypt автоматически продлевается; после продления Nginx перезагружает конфигурацию. Использован адрес sslip.io, указывающий на текущий IP; при смене IP нужно перенести адрес/сертификат панели. Копии данных требуют PostgreSQL dump и ClickHouse backup — одних compose-файлов недостаточно.

Официальная документация: https://rybbit.com/docs/self-hosting-guides/self-hosting-manual и https://rybbit.com/docs/track-events.
