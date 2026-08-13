import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-for-doctors',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './for-doctors.html',
  styleUrl: './for-doctors.css',
})
export class ForDoctorsComponent {
  readonly themeService = inject(ThemeService);

  readonly features = [
    {
      title: 'متابعة حية للحالات',
      desc: 'اعرف أين وصلت كل حالة داخل المعمل لحظة بلحظة — بدون انتظار مكالمة.',
    },
    {
      title: 'رفع الإسكانات بسهولة',
      desc: 'ارفع ملفات الإسكان مباشرة من حسابك بدل الإرسال اليدوي المتكرر.',
    },
    {
      title: 'واتساب عند اكتمال الحالة',
      desc: 'يصلك تنبيه على واتساب فور اكتمال الحالة وجاهزيتها للاستلام.',
    },
    {
      title: 'باركود وتتبع دقيق',
      desc: 'كل حالة مربوطة بباركود لضمان دقة التتبع وتقليل الأخطاء داخل المعمل.',
    },
    {
      title: 'تثبيت كتطبيق (PWA)',
      desc: 'ثبّت المنصة على شاشة الموبايل كأنها تطبيق — سريعة وجاهزة في أي وقت.',
    },
    {
      title: 'أقل مكالمات «فين حالتي؟»',
      desc: 'الشفافية توفّر وقت العيادة والمعمل، وتقلل الضغط على الجميع.',
    },
  ];
}