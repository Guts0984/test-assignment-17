import { createZodDto } from 'nestjs-zod';
import {
  bookingViewSchema,
  changeBookingSchema,
  confirmHoldSchema,
  confirmResponseSchema,
  createHoldSchema,
  holdResponseSchema,
  hotelListSchema,
  searchQuerySchema,
  searchResultSchema,
} from '@hotel/shared';

export class HotelListDto extends createZodDto(hotelListSchema) {}
export class SearchQueryDto extends createZodDto(searchQuerySchema) {}
export class SearchResultDto extends createZodDto(searchResultSchema) {}
export class CreateHoldDto extends createZodDto(createHoldSchema) {}
export class HoldResponseDto extends createZodDto(holdResponseSchema) {}
export class ConfirmHoldDto extends createZodDto(confirmHoldSchema) {}
export class ConfirmResponseDto extends createZodDto(confirmResponseSchema) {}
export class BookingViewDto extends createZodDto(bookingViewSchema) {}
export class ChangeBookingDto extends createZodDto(changeBookingSchema) {}
